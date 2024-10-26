'use strict';

import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import ByteArray from 'gi://GLib';


export default class LastCallPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings('org.gnome.shell.extensions.last-call');

    const page = new Adw.PreferencesPage();
    window.add(page);

    const group = new Adw.PreferencesGroup();
    page.add(group);

    const comboRow = new Adw.ComboRow({
      title: _('Select City:'),
    });
    group.add(comboRow);

    const citiesFilePath = `${this.dir.get_path()}/cities.json`;
    log(`Cities file path: ${citiesFilePath}`);

    const citiesFile = Gio.File.new_for_path(citiesFilePath);

    citiesFile.load_contents_async(null, (file, res) => {
      let contents;
      try {
        [/* success */, contents] = citiesFile.load_contents_finish(res);
        log('Cities file loaded successfully.');
      } catch (e) {
        logError(e);
        this._showErrorDialog(window, _('Failed to load cities.json'));
        return;
      }

      try {
        const contentsString = ByteArray.toString(contents);
        log(`Cities file contents: ${contentsString}`);

        const cities = JSON.parse(contentsString).cities;

        const stringList = new Gtk.StringList();
        for (const city of cities) {
          stringList.append(city.name);
        }
        comboRow.model = stringList;

        const activeIndex = cities.findIndex((c) => c.name === settings.get_string('selected-city'));
        comboRow.selected = activeIndex >= 0 ? activeIndex : 0;

        comboRow.connect('notify::selected', () => {
          const activeCity = comboRow.model.get_string(comboRow.selected);
          settings.set_string('selected-city', activeCity);
        });
      } catch (e) {
        logError(e);
        this._showErrorDialog(window, _('Invalid format in cities.json'));
      }
    });
  }

  _showErrorDialog(window, message) {
    const dialog = new Adw.MessageDialog({
      transient_for: window,
      modal: true,
      heading: _('Error'),
      body: message,
    });
    dialog.add_response('close', _('Close'));
    dialog.set_default_response('close');
    dialog.connect('response', () => dialog.close());
    dialog.show();
  }
}
