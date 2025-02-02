import ProficiencySelector from "../apps/proficiency-selector.js";
import TraitSelector from "../apps/trait-selector.js";
import ActiveEffect5e from "../active-effect.js";

/**
 * Override and extend the core ItemSheet implementation to handle specific item types.
 * @extends {ItemSheet}
 */
export default class ItemSheet5e extends ItemSheet {
    constructor(...args) {
        super(...args);

        // Expand the default size of the class sheet
        if (this.object.data.type === "class") {
            this.options.width = this.position.width = 600;
            this.options.height = this.position.height = 680;
        }
    }

    /* -------------------------------------------- */

    /** @inheritdoc */
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            width: 560,
            height: 400,
            classes: ["sw5e", "sheet", "item"],
            resizable: true,
            scrollY: [".tab.details"],
            tabs: [{navSelector: ".tabs", contentSelector: ".sheet-body", initial: "description"}],
            dragDrop: [{dragSelector: ".item-list .item", dropSelector: null}]
        });
    }

    /* -------------------------------------------- */

    /** @inheritdoc */
    get template() {
        const path = "systems/sw5e/templates/items/";
        return `${path}/${this.item.data.type}.html`;
    }

    /* -------------------------------------------- */

    /** @override */
    async getData(options) {
        const data = super.getData(options);
        const itemData = data.data;
        data.labels = this.item.labels;
        data.config = CONFIG.SW5E;

        // Item Type, Status, and Details
        data.itemType = game.i18n.localize(`ITEM.Type${data.item.type.titleCase()}`);
        data.itemStatus = this._getItemStatus(itemData);
        data.itemProperties = this._getItemProperties(itemData);
        data.baseItems = await this._getItemBaseTypes(itemData);
        data.isPhysical = itemData.data.hasOwnProperty("quantity");

        // Potential consumption targets
        data.abilityConsumptionTargets = this._getItemConsumptionTargets(itemData);

        // Action Details
        data.hasAttackRoll = this.item.hasAttack;
        data.isHealing = itemData.data.actionType === "heal";
        data.isFlatDC = getProperty(itemData, "data.save.scaling") === "flat";
        data.isLine = ["line", "wall"].includes(itemData.data.target?.type);
        if (itemData.data.critical) itemData.data.critical.baseThreshold = String(Math.max(20 - (itemData.data?.properties?.ken ?? 0), 1));

        // Original maximum uses formula
        const sourceMax = foundry.utils.getProperty(this.item.data._source, "data.uses.max");
        if (sourceMax) itemData.data.uses.max = sourceMax;

        // Vehicles
        const wpnType = (itemData.data?.weaponType ?? '');
        const armorType = (itemData.data?.armor?.type ?? '');
        data.isStarshipWeapon = wpnType in CONFIG.SW5E.weaponStarshipTypes;
        data.isStarshipArmor = armorType === "starship";
        data.isStarshipShield = armorType === "ssshield";
        data.isStarshipHyperdrive = armorType === "hyper";
        data.isStarshipPowerCoupling = armorType === "powerc";
        data.isStarshipReactor = armorType === "reactor";
        data.isStarshipEquipment = data.isStarshipArmor || data.isStarshipShield || data.isStarshipHyperdrive || data.isStarshipPowerCoupling || data.isStarshipReactor;
        data.isCrewed = itemData.data.activation?.type === "crew";
        data.isMountable = this._isItemMountable(itemData);

        // Weapon Properties
        if (this.item.type === "weapon") data.wpnProperties = data.isStarshipWeapon ? CONFIG.SW5E.weaponFullStarshipProperties : CONFIG.SW5E.weaponFullCharacterProperties;

        // Armor Class
        if (this.item.type === "equipment") {
            data.isArmor = this.item.isArmor;
            data.hasAC = data.isArmor || data.isMountable;
            data.hasDexModifier = data.isArmor && itemData.data.armor?.type !== "shield";
        }

        // Modification Properties
        if (this.item.type === "modification") {
            data.isEquipMod = itemData.data.modificationType in CONFIG.SW5E.modificationTypesEquipment;
            data.isWpnMod = itemData.data.modificationType in CONFIG.SW5E.modificationTypesWeapon;
            data.wpnProperties = CONFIG.SW5E.weaponFullCharacterProperties;
        }

        // Modification Slot Names
        if (itemData.data.modifications?.type) data.config.modSlots = CONFIG.SW5E.modificationSlots[itemData.data.modifications.type];

        // Prepare Active Effects
        data.effects = ActiveEffect5e.prepareActiveEffectCategories(this.item.effects);

        // Re-define the template data references (backwards compatible)
        data.item = itemData;
        data.data = itemData.data;
        return data;
    }

    /* -------------------------------------------- */

    /**
     * Get the base weapons and tools based on the selected type.
     *
     * @param {object} item        Item data for the item being displayed
     * @returns {Promise<object>}  Object with base items for this type formatted for selectOptions.
     * @protected
     */
    async _getItemBaseTypes(item) {
        const type = item.type === "equipment" ? "armor" : item.type;
        const typeProperty = type === "armor" ? "armor.type" : `${type}Type`;
        const baseType = foundry.utils.getProperty(item.data, typeProperty);

        const ids = CONFIG.SW5E[`${baseType === "shield" ? "shield" : type}Ids`];
        if (ids === undefined) return {};

        const items = await Object.entries(ids).reduce(async (acc, [name, id]) => {
            let baseItem = await ProficiencySelector.getBaseItem(id);

            // For some reason, loading a compendium item after the cache is generated deletes that item's data from the cache
            if (!baseItem?.data) baseItem = (await ProficiencySelector.getBaseItem(id, {fullItem: true}))?.data;

            if (!baseItem) return obj;

            const obj = await acc;
            if (baseType !== foundry.utils.getProperty(baseItem.data, typeProperty)) return obj;
            obj[name] = baseItem.name.replace(/\s*\([^)]*\)/g, ""); // Remove '(Rapid)' and '(Burst)' tags from item names
            return obj;
        }, {});

        return Object.fromEntries(Object.entries(items).sort((lhs, rhs) => lhs[1].localeCompare(rhs[1])));
    }

    /* -------------------------------------------- */

    /**
     * Get the valid item consumption targets which exist on the actor
     * @param {object} item          Item data for the item being displayed
     * @returns {{string: string}}   An object of potential consumption targets
     * @private
     */
    _getItemConsumptionTargets(item) {
        const consume = item.data.consume || {};
        if (!consume.type) return [];

        // Consume types not reliant on actor

        // Power Dice
        if (consume.type === "powerdice") {
            return Object.keys(CONFIG.SW5E.powerDieSlots).reduce((obj, pd) => {
                obj[`attributes.power.${pd}.value`] = game.i18n.localize(CONFIG.SW5E.powerDieSlots[pd]);
                return obj;
            }, {});
        }

        const actor = this.item.actor;
        if (!actor) return {};

        // Consume types reliant on actor

        // Ammunition
        if (consume.type === "ammo") {
            return actor.itemTypes.consumable.reduce(
                (ammo, i) => {
                    if (i.data.data.consumableType === "ammo") {
                        ammo[i.id] = `${i.name} (${i.data.data.quantity})`;
                    }
                    return ammo;
                },
                {[item._id]: `${item.name} (${item.data.quantity})`}
            );
        }

        // Attributes
        else if (consume.type === "attribute") {
            const attributes = TokenDocument.implementation.getConsumedAttributes(actor.data.data);
            attributes.bar.forEach((a) => a.push("value"));
            return attributes.bar.concat(attributes.value).reduce((obj, a) => {
                let k = a.join(".");
                obj[k] = k;
                return obj;
            }, {});
        }

        // Materials
        else if (consume.type === "material") {
            return actor.items.reduce((obj, i) => {
                if (["consumable", "loot"].includes(i.data.type) && !i.data.data.activation) {
                    obj[i.id] = `${i.name} (${i.data.data.quantity})`;
                }
                return obj;
            }, {});
        }

        // Charges
        else if (consume.type === "charges") {
            return actor.items.reduce((obj, i) => {
                // Limited-use items
                const uses = i.data.data.uses || {};
                if (uses.per && uses.max) {
                    const label =
                        uses.per === "charges"
                            ? ` (${game.i18n.format("SW5E.AbilityUseChargesLabel", {value: uses.value})})`
                            : ` (${game.i18n.format("SW5E.AbilityUseConsumableLabel", {
                                  max: uses.max,
                                  per: uses.per
                              })})`;
                    obj[i.id] = i.name + label;
                }

                // Recharging items
                const recharge = i.data.data.recharge || {};
                if (recharge.value) obj[i.id] = `${i.name} (${game.i18n.format("SW5E.Recharge")})`;
                return obj;
            }, {});
        }

        else return {};
    }

    /* -------------------------------------------- */

    /**
     * Get the text item status which is shown beneath the Item type in the top-right corner of the sheet.
     * @param {object} item    Copy of the item data being prepared for display.
     * @returns {string|null}  Item status string if applicable to item's type.
     * @private
     */
    _getItemStatus(item) {
        if (item.type === "power") {
            return CONFIG.SW5E.powerPreparationModes[item.data.preparation];
        } else if (["weapon", "equipment"].includes(item.type)) {
            return game.i18n.localize(item.data.equipped ? "SW5E.Equipped" : "SW5E.Unequipped");
        } else if (item.type === "tool") {
            return game.i18n.localize(item.data.proficient ? "SW5E.Proficient" : "SW5E.NotProficient");
        }
    }

    /* -------------------------------------------- */

    /**
     * Get the Array of item properties which are used in the small sidebar of the description tab.
     * @param {object} item  Copy of the item data being prepared for display.
     * @returns {string[]}   List of property labels to be shown.
     * @private
     */
    _getItemProperties(item) {
        const props = [];
        const labels = this.item.labels;

        if (item.type === "weapon") {
            props.push(
                ...Object.entries(item.data.properties)
                    .filter((e) => ![false, undefined, null, 0].includes(e[1]))
                    .map((e) => game.i18n.format(CONFIG.SW5E.weaponProperties[e[0]].full, { value: e[1] }))
            );
        } else if (item.type === "power") {
            props.push(
                labels.materials,
                item.data.components.concentration ? game.i18n.localize("SW5E.Concentration") : null,
                item.data.components.ritual ? game.i18n.localize("SW5E.Ritual") : null
            );
        } else if (item.type === "equipment") {
            props.push(CONFIG.SW5E.equipmentTypes[item.data.armor.type]);
            if (this.item.isArmor || this._isItemMountable(item)) props.push(labels.armor);
            if (item.data.properties) props.push(
                ...Object.entries(item.data.properties)
                    .filter((e) => ![false, undefined, null, 0].includes(e[1]))
                    .map((e) => game.i18n.format(CONFIG.SW5E.armorProperties[e[0]].full, { value: e[1] }))
            );
        } else if (item.type === "feat") {
            props.push(labels.featType);
            //TODO: Work out these
        } else if (item.type === "species") {
            //props.push(labels.species);
        } else if (item.type === "archetype") {
            //props.push(labels.archetype);
        } else if (item.type === "background") {
            //props.push(labels.background);
        } else if (item.type === "classfeature") {
            //props.push(labels.classfeature);
        } else if (item.type === "deployment") {
            //props.push(labels.deployment);
        } else if (item.type === "venture") {
            //props.push(labels.venture);
        } else if (item.type === "fightingmastery") {
            //props.push(labels.fightingmastery);
        } else if (item.type === "fightingstyle") {
            //props.push(labels.fightingstyle);
        } else if (item.type === "lightsaberform") {
            //props.push(labels.lightsaberform);
        }

        // Action type
        if (item.data.actionType) {
            props.push(CONFIG.SW5E.itemActionTypes[item.data.actionType]);
        }

        // Action usage
        if (item.type !== "weapon" && item.data.activation && !isObjectEmpty(item.data.activation)) {
            props.push(labels.activation, labels.range, labels.target, labels.duration);
        }
        return props.filter((p) => !!p);
    }

    /* -------------------------------------------- */

    /**
     * Is this item a separate large object like a siege engine or vehicle component that is
     * usually mounted on fixtures rather than equipped, and has its own AC and HP.
     * @param {object} item  Copy of item data being prepared for display.
     * @returns {boolean}    Is item siege weapon or vehicle equipment?
     * @private
     */
    _isItemMountable(item) {
        const data = item.data;
        return (
            (item.type === "weapon" && data.weaponType === "siege") ||
            (item.type === "equipment" && data.armor.type === "vehicle")
        );
    }

    /* -------------------------------------------- */

    /** @inheritdoc */
    setPosition(position = {}) {
        if (!(this._minimized || position.height)) {
            position.height = this._tabs[0].active === "details" ? "auto" : this.options.height;
        }
        return super.setPosition(position);
    }

    /* -------------------------------------------- */
    /*  Form Submission                             */
    /* -------------------------------------------- */

    /** @inheritdoc */
    _getSubmitData(updateData = {}) {
        // Create the expanded update data object
        const fd = new FormDataExtended(this.form, {editors: this.editors});
        let data = fd.toObject();
        if (updateData) data = mergeObject(data, updateData);
        else data = expandObject(data);

        // Handle Damage array
        const damage = data.data?.damage;
        if (damage) damage.parts = Object.values(damage?.parts || {}).map((d) => [d[0] || "", d[1] || ""]);

        // Check max uses formula
        if (data.data?.uses?.max) {
            const maxRoll = new Roll(data.data.uses.max);
            if (!maxRoll.isDeterministic) {
                data.data.uses.max = this.object.data._source.data.uses.max;
                this.form.querySelector("input[name='data.uses.max']").value = data.data.uses.max;
                ui.notifications.error(
                    game.i18n.format("SW5E.FormulaCannotContainDiceWarn", {
                        name: game.i18n.localize("SW5E.LimitedUses")
                    })
                );
            }
        }

        // Flatten the submission data
        data = flattenObject(data);

        // Prevent submitting overridden values
        const overrides = foundry.utils.flattenObject(this.item.overrides);
        for ( let k of Object.keys(overrides) ) {
            delete data[k];
        }

        return data;
    }

    /* -------------------------------------------- */

    /** @inheritdoc */
    async _renderInner(...args) {
        const html = await super._renderInner(...args);
        const els = this.form.getElementsByClassName("tristate-checkbox");
        for (const el of els) {
            const indet_path = el.name.replace(/(\w+)[.](\w+)$/, '$1.indeterminate.$2');
            el.indeterminate = (foundry.utils.getProperty(this.item.data, indet_path) != false);
        }
        return html;
    }

    /* -------------------------------------------- */

    /** @inheritdoc */
    activateListeners(html) {
        super.activateListeners(html);
        if (this.isEditable) {
            html.find(".damage-control").click(this._onDamageControl.bind(this));
            html.find(".trait-selector.class-skills").click(this._onConfigureTraits.bind(this));
            html.find(".effect-control").click((ev) => {
                if (this.item.isEmbedded)
                    return ui.notifications.warn(
                        "Managing Active Effects within an Owned Item is not currently supported and will be added in a subsequent update."
                    );
                ActiveEffect5e.onManageActiveEffect(ev, this.item);
            });
            html.find(".tristate-checkbox").click(async (ev) => {
                ev.preventDefault();

                const update = {};

                const path = ev.target.name;
                const indet_path = path.replace(/(\w+)[.](\w+)$/, '$1.indeterminate.$2');

                const val = foundry.utils.getProperty(this.item.data, path);
                const indet_val = foundry.utils.getProperty(this.item.data, indet_path) != false;

                if ( indet_val ) {
                    update[path] = false;
                    update[indet_path] = false;
                }
                else {
                    update[path] = !val;
                    update[indet_path] = val;
                }

                await this.item.update(update);
            });
            html.find(".modification-control").click(this._onManageItemModification.bind(this));
        }
    }

    /* -------------------------------------------- */

    /**
     * Add or remove a damage part from the damage formula.
     * @param {Event} event             The original click event.
     * @returns {Promise<Item5e>|null}  Item with updates applied.
     * @private
     */
    async _onDamageControl(event) {
        event.preventDefault();
        const a = event.currentTarget;

        // Don't allow adding or removing damage parts while there is a mod affecting those, to avoid duplication
        if ("data.damage.parts" in flattenObject(this.item.overrides)) return ui.notifications.warn(
            `Can't change ${this.item.name}'s damage formulas while there is a mod affecting those.`
        );

        // Add new damage component
        if (a.classList.contains("add-damage")) {
            await this._onSubmit(event); // Submit any unsaved changes
            const damage = this.item.data.data.damage;
            return this.item.update({"data.damage.parts": damage.parts.concat([["", ""]])});
        }

        // Remove a damage component
        if (a.classList.contains("delete-damage")) {
            await this._onSubmit(event); // Submit any unsaved changes
            const li = a.closest(".damage-part");
            const damage = foundry.utils.deepClone(this.item.data.data.damage);
            damage.parts.splice(Number(li.dataset.damagePart), 1);
            return this.item.update({"data.damage.parts": damage.parts});
        }
    }

    /* -------------------------------------------- */

    /**
     * Handle spawning the TraitSelector application for selection various options.
     * @param {Event} event   The click event which originated the selection.
     * @private
     */
    _onConfigureTraits(event) {
        event.preventDefault();
        const a = event.currentTarget;

        const options = {
            name: a.dataset.target,
            title: a.parentElement.innerText,
            choices: [],
            allowCustom: false
        };

        switch (a.dataset.options) {
            case "saves":
                options.choices = CONFIG.SW5E.abilities;
                options.valueKey = null;
                break;
            case "skills.choices":
                options.choices = CONFIG.SW5E.skills;
                options.valueKey = null;
                break;
            case "skills":
                const skills = this.item.data.data.skills;
                const choiceSet = skills.choices?.length ? skills.choices : Object.keys(CONFIG.SW5E.skills);
                options.choices = Object.fromEntries(
                    Object.entries(CONFIG.SW5E.skills).filter(([skill]) => choiceSet.includes(skill))
                );
                options.maximum = skills.number;
                break;
        }
        new TraitSelector(this.item, options).render(true);
    }

    /* -------------------------------------------- */

    /**
     * Handle deleting and toggling item modifications.
     * @param {Event} event   The click event
     * @private
     */
    _onManageItemModification(event) {
        event.preventDefault();
        const a = event.currentTarget;
        const li = a.closest("li");
        switch ( li.dataset.modificationType ) {
            case "mod":
                const slot = li.dataset.modificationSlot;
                const mod = {...this.item.data.data.modifications.mods[slot]};
                switch ( a.dataset.action ) {
                    case "delete":
                        mod.uuid = null;
                        break;
                    case "toggle":
                        mod.disabled = !mod.disabled;
                        break;
                }
                const update = {};
                update[`data.modifications.mods.${slot}`] = mod;
                return this.item.update(update);
            case "augment":
                const index = li.dataset.augmentIndex;
                const augments = [...this.item.data.data.modifications.augments];
                switch ( a.dataset.action ) {
                    case "delete":
                        augments.splice(index, 1);
                        break;
                    case "toggle":
                        augments[index].disabled = !augments[index].disabled;
                        break;
                }
                return this.item.update({'data.modifications.augments': augments});
        }
    }

    /* -------------------------------------------- */

    /** @inheritdoc */
    async _onSubmit(...args) {
        if (this._tabs[0].active === "details") this.position.height = "auto";
        await super._onSubmit(...args);
    }

    /* -------------------------------------------- */
    /*  Drag and Drop                               */
    /* -------------------------------------------- */

    /** @inheritdoc */
    _canDragDrop(selector) {
        return this.isEditable;
    }

    /* -------------------------------------------- */

    /** @inheritdoc */
    async _onDrop(event) {
        // Try to extract the data
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData('text/plain'));
        } catch (err) {
            return false;
        }
        const item = this.item;

        /**
         * A hook event that fires when some useful data is dropped onto an ItemSheet.
         * @function dropItemSheetData
         * @memberof hookEvents
         * @param {Item} item        The Item
         * @param {ItemSheet} sheet  The ItemSheet application
         * @param {object} data      The data that has been dropped onto the sheet
         * @param {event} event      The event that triggered the drop
         */
        const allowed = Hooks.call("dropItemSheetData", item, this, data, event);
        if ( allowed === false ) return;

        // Handle different data types
        switch ( data.type ) {
            case "Item":
                return await this._onDropItem(event, data);
        }
    }

    /* -------------------------------------------- */

    /**
     * Handle dropping of an item reference or item data onto an Item Sheet
     * @param {DragEvent} event     The concluding DragEvent which contains drop data
     * @param {Object} data         The data transfer extracted from the event
     * @return {Promise<Object>}    A data object which describes the result of the drop
     * @private
     */
    async _onDropItem(event, data) {
        const item = this.item.data;
        const itemMods = item.data.modifications;

        const entity = await Item.fromDropData(data, {importWorld: !data.pack});
        if (!entity) return false;

        if (itemMods && entity.type == "modification"){
            const mod = entity.data;

            const rarityMap = {
                "standard": 1,
                "premium": 2,
                "prototype": 3,
                "advanced": 4,
                "legendary": 5,
                "artifact": 6
            }

            if (["none", "enhanced"].includes(itemMods.chassisType)) return ui.notifications.warn(
                `${item.name}'s does not have a chassis that support modifications.`
            );
            if (itemMods.chassisType == "chassis" && (rarityMap[item.data.rarity]??0) < (rarityMap[mod.data.rarity]??0)) return ui.notifications.warn(
                `${item.name}'s chassis only supports modifications of rarity up to ${item.data.rarity ?? "common"}.`
            );

            if (mod.data.modificationType == "augment") {
                const augments = itemMods.augments;
                if (augments.length >= itemMods.augmentSlots) return ui.notifications.warn(
                    `${item.name} has no empty augment slots for ${mod.name}.`
                );
                if (augments.filter(e => e.uuid == entity.uuid).length) return ui.notifications.warn(
                    `${item.name} already has an augment called ${mod.name}.`
                );
                augments.push({
                    uuid: entity.uuid,
                    disabled: false,
                });
                this.item.update({"data.modifications.augments": augments});
            }
            else {
                if (itemMods.type != mod.data.modificationType) return ui.notifications.warn(
                    `${mod.name}'s mod type ${mod.data.modificationType} is incompatible with ${item.name}, which only accepts ${itemMods.type}.`
                );
                const slot = mod.data.modificationSlot;

                const update = {}
                update[`data.modifications.mods.${slot}.uuid`] = entity.uuid;
                update[`data.modifications.mods.${slot}.disabled`] = false;
                this.item.update(update);
            }

            if (this.item.sheet?.rendered) this.item.sheet.render(true);
            return true
        }
    }

    /* -------------------------------------------- */
}
