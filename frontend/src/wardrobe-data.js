// frontend/src/wardrobe-data.js
export const WARDROBE_ITEMS = [
    { id: 'denim-jacket', img: './resources/wardrobe/denim_jacket.webp', label: 'Denim Jacket' },
    { id: 'blue-suit', img: './resources/wardrobe/blue_suit.jpg', label: 'Blue Suit' },
    { id: 'navy-suit', img: './resources/wardrobe/navy_suit.jpg', label: 'Navy Suit' },
    { id: 'party-suit', img: './resources/wardrobe/party_suit.jpg', label: 'Party Suit' },
    {
        id: 'yellow-shirt',
        img: './resources/wardrobe/yellow_polo_shirt.png',
        label: 'Yellow P-Shirt',
    },
    {
        id: 'green-shirt',
        img: './resources/wardrobe/green_polo_shirt.webp',
        label: 'Green P-Shirt',
    },
    { id: 'white-shirt', img: './resources/wardrobe/white_shirt.webp', label: 'White Shirt' },
    { id: 'blue-shirt', img: './resources/wardrobe/blue_shirt.jpg', label: 'Blue Shirt' },
    { id: 'beige-knit', img: './resources/wardrobe/beige_knit.webp', label: 'Beige Knit' },
    { id: 'beige-pants', img: './resources/wardrobe/beige_pants.webp', label: 'Beige Pants' },
    { id: 'denim-pants', img: './resources/wardrobe/denim_pants.jpg', label: 'Denim Pants' },
];

export function renderWardrobeGrid(rootEl) {
    if (!rootEl) return;
    rootEl.innerHTML = WARDROBE_ITEMS.map(
        ({ id, img, label }) => `
    <button
      class="snap-start shrink-0 w-40 rounded-xl bg-zinc-800/50 p-3 ring-1 ring-zinc-700 hover:ring-blue-400 wardrobe-item"
      data-garment-id="${id}">
      <img src="${img}" alt="${label}" class="w-full h-36 object-contain rounded-lg mb-2">
      <div class="text-sm text-zinc-200 text-left">${label}</div>
    </button>
  `
    ).join('');
}
