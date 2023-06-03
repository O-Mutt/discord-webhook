export type EmbedKey = '' | 'author' | 'footer' | 'image' | 'thumbnail'

export type Embed = {
  [key in EmbedKey]: string[]
}
