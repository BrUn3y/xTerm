// An exact local match keeps this draft buildable until the official file is available.
const artwork = import.meta.glob<string>('./bob-standing-BECrMjXJ.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const bobArtwork: string | undefined = artwork['./bob-standing-BECrMjXJ.webp'];
