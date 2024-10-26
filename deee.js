import GLib from 'gi://GLib';

// ...

citiesFile.load_contents_async(null, (file, res) => {
  let contents;
  try {
    [/* success */, contents] = citiesFile.load_contents_finish(res);

    // UTF-8 olarak string'e çevir
    const decoder = new TextDecoder('utf-8');
    const contentsString = decoder.decode(contents);

    log(`Cities file contents: ${contentsString}`);

    const cities = JSON.parse(contentsString).cities;

    // ... (kalan kod)
  } catch (e) {
    logError(e);
    this._showErrorDialog(window, _('Invalid format in cities.json'));
  }
});