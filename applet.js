const Applet = imports.ui.applet;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Soup = imports.gi.Soup;
const Gio = imports.gi.Gio;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const Main = imports.ui.main;

const _httpSession = new Soup.Session();

function MyApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

MyApplet.prototype = {
    __proto__: Applet.TextIconApplet.prototype,

    _init: function(metadata, orientation, panel_height, instance_id) {
        try {
            Applet.TextIconApplet.prototype._init.call(this, orientation, panel_height, instance_id);
            this.metadata = metadata;
            this.settings = new Settings.AppletSettings(this, metadata.uuid, instance_id);
            
            this.settings.bindProperty(Settings.BindingDirection.IN, "location_mode", "location_mode", this._onSettingsChanged, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "city", "city", this._onSettingsChanged, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "lat", "lat", this._onSettingsChanged, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "lng", "lng", this._onSettingsChanged, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "use_12h", "use_12h", this._onSettingsChanged, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "enable_audio", "enable_audio", null, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "method", "method", this._onSettingsChanged, null);

            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation);
            this.menuManager.addMenu(this.menu);

            this.date_info = { hijri: "..." };
            this.set_applet_icon_name("calendar");
            
            this._updateData();
        } catch (e) { global.logError(e); }
    },

    on_applet_clicked: function() { this.menu.toggle(); },

    _onSettingsChanged: function() { this._updateData(); },

    on_get_location_clicked: function() {
        let msg = Soup.Message.new("GET", "http://ip-api.com/json");
        _httpSession.send_and_read_async(msg, 0, null, (session, res) => {
            try {
                let bytes = _httpSession.send_and_read_finish(res);
                let data = JSON.parse(new TextDecoder().decode(bytes.toArray()));
                if (data.status === "success") {
                    this.settings.setValue("location_mode", "coords");
                    this.settings.setValue("lat", data.lat.toString());
                    this.settings.setValue("lng", data.lon.toString());
                    Main.notify("v2.0 - الموقع", `تم تحديث الموقع لـ: ${data.city}`);
                }
            } catch (e) { Main.notify("خطأ", "تعذر الاتصال بسيرفر الموقع"); }
        });
    },

    _formatTime: function(timeStr) {
        if (!this.use_12h) return timeStr;
        let [hours, minutes] = timeStr.split(':').map(Number);
        let ampm = hours >= 12 ? 'م' : 'ص';
        hours = hours % 12 || 12;
        return `${hours}:${minutes < 10 ? '0' + minutes : minutes} ${ampm}`;
    },

    _updateData: function() {
        let methodId = parseInt(this.method);
        let url = (this.location_mode === "coords") 
            ? `https://api.aladhan.com/v1/timings?latitude=${this.lat}&longitude=${this.lng}&method=${methodId}`
            : `https://api.aladhan.com/v1/timingsByCity?city=${this.city}&country=SA&method=${methodId}`;

        let message = Soup.Message.new("GET", url);
        _httpSession.send_and_read_async(message, 0, null, (session, res) => {
            try {
                let bytes = _httpSession.send_and_read_finish(res);
                if (!bytes) throw new Error("لا يوجد اتصال");
                
                let data = JSON.parse(new TextDecoder().decode(bytes.toArray()));
                if (data && data.data) {
                    this.timings = data.data.timings;
                    let d = data.data.date;
                    this.date_info.hijri = `${d.hijri.day} ${d.hijri.month.ar} ${d.hijri.year}`;
                    this._buildMenu();
                    this._runCountdown();
                } else {
                    throw new Error("بيانات ناقصة");
                }
            } catch (e) {
                // الحل الذكي: إعادة المحاولة بعد 10 ثوانٍ في حال فشل الإقلاع الأول
                this.set_applet_label("جاري الاتصال...");
                if (this._retryId) Mainloop.source_remove(this._retryId);
                this._retryId = Mainloop.timeout_add_seconds(10, () => this._updateData());
            }
        });

        if (this._updateId) Mainloop.source_remove(this._updateId);
        this._updateId = Mainloop.timeout_add_seconds(21600, () => this._updateData());
    },

    _buildMenu: function() {
        this.menu.removeAll();
        let titleItem = new PopupMenu.PopupMenuItem(this.date_info.hijri, { reactive: false });
        titleItem.actor.add_style_class_name("prayer-popup-title");
        this.menu.addMenuItem(titleItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let prayers = [
            {id:"Fajr", n:"الفجر"}, {id:"Sunrise", n:"الشروق"}, 
            {id:"Dhuhr", n:"الظهر"}, {id:"Asr", n:"العصر"}, 
            {id:"Maghrib", n:"المغرب"}, {id:"Isha", n:"العشاء"}
        ];

        for (let p of prayers) {
            let item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
            let box = new St.BoxLayout({ style_class: 'prayer-box' });
            let label = new St.Label({ text: p.n, style_class: 'prayer-item-label' });
            let time = new St.Label({ text: this._formatTime(this.timings[p.id]), style_class: 'prayer-item-time' });
            box.add(label);
            box.add(new St.Bin(), { expand: true });
            box.add(time);
            item.addActor(box);
            this.menu.addMenuItem(item);
        }
    },

    _runCountdown: function() {
        if (!this.timings) return;
        let now = new Date();
        let list = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
        let next = null, nextT = null;

        for (let name of list) {
            let [h, m] = this.timings[name].split(':');
            let d = new Date(); d.setHours(parseInt(h), parseInt(m), 0);
            if (d > now) { next = name; nextT = d; break; }
        }

        if (next) {
            let diff = Math.floor((nextT - now) / 1000);
            let mins = Math.floor(diff / 60);
            let secs = diff % 60;
            this.set_applet_label(`${this._translate(next)}: -${mins}:${secs < 10 ? '0'+secs : secs}`);
            if (mins < 10) this.actor.add_style_class_name("urgent-label");
            else this.actor.remove_style_class_name("urgent-label");
        } else {
            this.set_applet_label("انتظار الفجر");
            this.actor.remove_style_class_name("urgent-label");
        }
        if (this._timerId) Mainloop.source_remove(this._timerId);
        this._timerId = Mainloop.timeout_add_seconds(1, () => this._runCountdown());
    },

    _translate: function(n) {
        let d = {"Fajr":"الفجر","Dhuhr":"الظهر","Asr":"العصر","Maghrib":"المغرب","Isha":"العشاء"};
        return d[n] || n;
    }
};

function main(metadata, orientation, panel_height, instance_id) {
    return new MyApplet(metadata, orientation, panel_height, instance_id);
}
