/**
 * Navigation labels are dictionary keys. Declared as a string here to keep this package independent of
 * the localization package; the app shell validates keys against the dictionary at render time and a
 * test in the app-shell package guarantees every nav key exists in both languages.
 */
export type DictionaryKeyLike = `nav.${string}`;
