/**
 * A helper Dialog subclass for completing a refitting repair
 * @extends {Dialog}
 */
export default class RefittingRepairDialog extends Dialog {
    constructor(actor, dialogData = {}, options = {}) {
        super(dialogData, options);
        this.actor = actor;
    }

    /* -------------------------------------------- */

    /** @override */
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            template: "systems/sw5e/templates/apps/refitting-repair.html",
            classes: ["sw5e", "dialog"]
        });
    }

    /* -------------------------------------------- */

    /** @override */
    getData() {
        const data = super.getData();
        const variant = game.settings.get("sw5e", "restVariant");
        data.promptNewDay = variant !== "gritty"; // It's always a new day when resting 1 week
        data.newDay = variant === "normal"; // It's probably a new day when resting normally (8 hours)
        return data;
    }

    /* -------------------------------------------- */

    /**
     * A helper constructor function which displays the Refitting Repair confirmation dialog and returns a Promise once it's
     * workflow has been resolved.
     * @param {Actor5e} actor
     * @return {Promise}
     */
    static async refittingRepairDialog({actor} = {}) {
        return new Promise((resolve, reject) => {
            const dlg = new this(actor, {
                title: "Refitting Repair",
                buttons: {
                    rest: {
                        icon: '<i class="fas fa-bed"></i>',
                        label: "Repair",
                        callback: (html) => {
                            let newDay = false;
                            if (game.settings.get("sw5e", "restVariant") === "normal")
                                newDay = html.find('input[name="newDay"]')[0].checked;
                            else if (game.settings.get("sw5e", "restVariant") === "gritty") newDay = true;
                            resolve(newDay);
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel",
                        callback: reject
                    }
                },
                default: "repair",
                close: reject
            });
            dlg.render(true);
        });
    }
}
