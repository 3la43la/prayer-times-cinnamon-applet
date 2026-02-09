const Applet = imports.ui.applet;
const Soup = imports.gi.Soup;
const GLib = imports.gi.GLib;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const ByteArray = imports.byteArray;
const Main = imports.ui.main;

class PrayerTimesApplet extends Applet.TextApplet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this.metadata = metadata;
        this.instanceId = instanceId;
        this.prayerTimings = null;
        this.lastNotified = ""; 

        try {
            this.settings = new Settings.AppletSettings(this, metadata.uuid, instanceId);
            this.settings.bindProperty(Settings.BindingDirection.IN, "city", "city", () => this._updateData(), null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "country", "country", () => this._updateData(), null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "method", "method", () => this._updateData(), null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "timeFormat", "timeFormat", () => this._fillMenu(), null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "enableSound", "enableSound", null, null);
        } catch (e) {
            global.logError("PrayerApplet: Settings error: " + e.message);
        }

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this.session = new Soup.Session();
        this._updateData();

        // تحديث العد التنازلي كل دقيقة
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._refreshDisplay();
            return true;
        });
    }

    on_applet_clicked(event) {
        this.menu.toggle();
    }

    _formatTime(timeStr) {
        if (!timeStr) return "--:--";
        if (this.timeFormat !== "12h") return timeStr;
        try {
            let [hours, minutes] = timeStr.split(':');
            let h = parseInt(hours);
            let ampm = h >= 12 ? 'م' : 'ص';
            h = h % 12 || 12;
            return `${h}:${minutes} ${ampm}`;
        } catch (e) { return timeStr; }
    }

    _updateData() {
        // تنظيف المدخلات لضمان عمل الرابط بشكل صحيح
        let city = encodeURIComponent(this.city.trim());
        let country = encodeURIComponent(this.country.trim());
        let url = `https://api.aladhan.com/v1/timingsByCity?city=${city}&country=${country}&method=${this.method}`;

        let message = Soup.Message.new("GET", url);
        this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
            try {
                let response = session.send_and_read_finish(res);
                let data = ByteArray.toString(response.get_data());
                let json = JSON.parse(data);

                if (json && json.data && json.data.timings) {
                    this.prayerTimings = json.data.timings;
                    this._refreshDisplay();
                    this._fillMenu();
                } else {
                    throw new Error("Invalid JSON structure");
                }
            } catch (e) {
                global.logError("PrayerApplet Data Error: " + e.message);
                this.set_applet_label("خطأ بيانات (تحقق من المدينة)");
            }
        });
    }

    _refreshDisplay() {
        if (!this.prayerTimings) return;
        try {
            const next = this._calculateNextPrayer(this.prayerTimings);
            this.set_applet_label(`${next.name} خلال ${next.time}`);
            if (next.rawDiff <= 0 && this.lastNotified !== next.name) {
                this._doNotify(next.name);
            }
        } catch (e) { global.logError("PrayerApplet Refresh Error: " + e.message); }
    }

    _calculateNextPrayer(timings) {
        const now = new Date();
        const prayers = [
            {en: "Fajr", ar: "الفجر"}, {en: "Dhuhr", ar: "الظهر"},
            {en: "Asr", ar: "العصر"}, {en: "Maghrib", ar: "المغرب"},
            {en: "Isha", ar: "العشاء"}
        ];

        for (let p of prayers) {
            if (!timings[p.en]) continue;
            let [h, m] = timings[p.en].split(':');
            let pTime = new Date();
            pTime.setHours(parseInt(h), parseInt(m), 0);

            if (pTime > now) {
                let diff = Math.floor((pTime - now) / 60000);
                let hours = Math.floor(diff / 60);
                let mins = diff % 60;
                return { name: p.ar, time: `${hours}:${mins < 10 ? '0'+mins : mins}`, rawDiff: diff };
            }
        }
        return { name: "الفجر", time: "--:--", rawDiff: 999 };
    }

    _doNotify(prayerName) {
        Main.notify("🕌 موعد الأذان", `حان الآن وقت أذان ${prayerName}`);
        if (this.enableSound) {
            let soundPath = GLib.build_filenamev([this.metadata.path, "azaan.wav"]);
            GLib.spawn_command_line_async(`play "${soundPath}"`);
            GLib.spawn_command_line_async(`aplay "${soundPath}"`);
        }
        this.lastNotified = prayerName;
    }

    _fillMenu() {
        if (!this.prayerTimings) return;
        this.menu.removeAll();
        const namesAr = { "Fajr": "الفجر", "Dhuhr": "الظهر", "Asr": "العصر", "Maghrib": "المغرب", "Isha": "العشاء" };
        
        let head = new PopupMenu.PopupMenuItem(`مواقيت: ${this.city}`, { reactive: false });
        this.menu.addMenuItem(head);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        for (let key in namesAr) {
            let time = this._formatTime(this.prayerTimings[key]);
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem(`${namesAr[key]}: ${time}`));
        }
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new PrayerTimesApplet(metadata, orientation, panelHeight, instanceId);
}
