// import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
// import St from 'gi://St';
// import Clutter from 'gi://Clutter';
// import Gio from 'gi://Gio';
// import GLib from 'gi://GLib';
// import * as Main from 'resource:///org/gnome/shell/ui/main.js';
// import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
// import * as Util from 'resource:///org/gnome/shell/misc/util.js';
// import { fetchPrayerTimes } from './utils.js';  // utils.js'den fetch fonksiyonu


const { Gio, GObject, Gtk } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

function init() {
}

function buildPrefsWidget() {
  let widget = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10,
    margin_top: 20,
    margin_bottom: 20,
    margin_start: 20,
    margin_end: 20,
  });

  let settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.last-call');

  let label = new Gtk.Label({ label: _('Select City:'), xalign: 0 });
  widget.append(label);

  let comboBox = new Gtk.ComboBoxText();
  let citiesFile = Gio.File.new_for_path(`${Me.path}/cities.json`);
  let [, contents] = citiesFile.load_contents(null);
  let cities = JSON.parse(imports.byteArray.toString(contents)).cities;

  for (let city of cities) {
    comboBox.append_text(city.name);
  }

  comboBox.set_active(cities.findIndex(c => c.name === settings.get_string('selected-city')));

  comboBox.connect('changed', () => {
    settings.set_string('selected-city', comboBox.get_active_text());
  });

  widget.append(comboBox);

  widget.show();

  return widget;
}
