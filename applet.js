const Applet = imports.ui.applet;
const Soup = imports.gi.Soup;
const GLib = imports.gi.GLib;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const ByteArray = imports.byteArray;
const Main = imports.ui.main;

class PrayerTimesApplet extends Applet.TextIconApplet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this.settings = new Settings.AppletSettings(this, metadata.uuid, instanceId);
        this.settings.bindProperty(Settings.BindingDirection.IN, "city", "city", this._updateData.bind(this), null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "country", "country", this._updateData.bind(this), null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "method", "method", this._updateData.bind(this), null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "appLocale", "appLocale", this._refreshUI.bind(this), null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "timeFormat", "timeFormat", this._refreshUI.bind(this), null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "enableSound", "enableSound", null, null);

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this.prayerData = null;
        this.session = new Soup.Session();
        this._updateData();

        // تحديث كل دقيقة بدقة
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._refreshUI();
            return true;
        });
    }

    _t(key) {
        const i18n = {
            'Fajr': {ar: 'الفجر', en: 'Fajr'},
            'Dhuhr': {ar: 'الظهر', en: 'Dhuhr'},
            'Asr': {ar: 'العصر', en: 'Asr'},
            'Maghrib': {ar: 'المغرب', en: 'Maghrib'},
            'Isha': {ar: 'العشاء', en: 'Isha'},
            'within': {ar: 'خلال', en: 'in'},
            'hijri': {ar: 'الهجري', en: 'Hijri'}
        };
        return i18n[key] ? i18n[key][this.appLocale] : key;
    }

    _updateData() {
        let url = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(this.city)}&country=${encodeURIComponent(this.country)}&method=${this.method}`;
        let message = Soup.Message.new("GET", url);
        this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
            try {
                let response = session.send_and_read_finish(res);
                this.prayerData = JSON.parse(ByteArray.toString(response.get_data())).data;
                this._refreshUI();
            } catch (e) { this.set_applet_label("!"); }
        });
    }

    _refreshUI() {
        if (!this.prayerData) return;
        
        let now = new Date();
        let timings = this.prayerData.timings;
        let prayers = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
        let nextPrayer = null;

        for (let p of prayers) {
            let [h, m] = timings[p].split(':');
            let pDate = new Date();
            pDate.setHours(h, m, 0);

            if (pDate > now) {
                nextPrayer = { name: p, date: pDate };
                break;
            }
        }

        // إذا انتهت صلوات اليوم، ابحث عن فجر الغد
        if (!nextPrayer) {
            let [h, m] = timings["Fajr"].split(':');
            let pDate = new Date();
            pDate.setDate(pDate.getDate() + 1);
            pDate.setHours(h, m, 0);
            nextPrayer = { name: "Fajr", date: pDate };
            // تحديث البيانات لليوم الجديد عند منتصف الليل
            if (now.getHours() === 0 && now.getMinutes() < 5) this._updateData();
        }

        let diffMs = nextPrayer.date - now;
        let diffMins = Math.floor(diffMs / 60000);
        let h = Math.floor(diffMins / 60);
        let m = diffMins % 60;

        this.set_applet_label(`${this._t(nextPrayer.name)} ${this._t('within')} ${h}:${m < 10 ? '0'+m : m}`);
        this._updateIcon(nextPrayer.name);
        this._fillMenu();
    }

    _updateIcon(p) {
        let icons = { Fajr: "weather-few-clouds-night-symbolic", Dhuhr: "weather-clear-symbolic", Asr: "weather-few-clouds-symbolic", Maghrib: "weather-sunset-symbolic", Isha: "weather-clear-night-symbolic" };
        this.set_applet_icon_symbolic_name(icons[p] || "weather-clear-symbolic");
    }

    _fillMenu() {
        this.menu.removeAll();
        if (!this.prayerData) return;
        
        let h = this.prayerData.date.hijri;
        this.menu.addMenuItem(new PopupMenu.PopupMenuItem(`${this._t('hijri')}: ${h.day} ${this.appLocale === 'ar' ? h.month.ar : h.month.en} ${h.year}`, {reactive: false}));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"].forEach(p => {
            let time = this.prayerData.timings[p];
            if (this.timeFormat === "12h") {
                let [hh, mm] = time.split(':');
                hh = parseInt(hh);
                let ampm = hh >= 12 ? (this.appLocale === 'ar' ? 'م' : 'PM') : (this.appLocale === 'ar' ? 'ص' : 'AM');
                time = `${hh % 12 || 12}:${mm} ${ampm}`;
            }
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem(`${this._t(p)}: ${time}`));
        });
    }

    on_applet_clicked() { this.menu.toggle(); }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new PrayerTimesApplet(metadata, orientation, panelHeight, instanceId);
}