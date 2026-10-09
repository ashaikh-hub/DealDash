-- Search normalisation: unify alef forms (alef with hamza/madda -> alef), alef maksura -> yeh, teh marbuta -> heh,
-- remove diacritics and tatweel, and map Arabic-Indic digits to Western digits so "٣٠" and "30" match.
CREATE OR REPLACE FUNCTION dd_norm_ar(input text) RETURNS text AS $$
  SELECT lower(
    regexp_replace(
      translate(coalesce(input, ''), 'أإآىة٠١٢٣٤٥٦٧٨٩', 'ااايه0123456789'),
      '[ً-ٰٟـ]', '', 'g'
    )
  );
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;
