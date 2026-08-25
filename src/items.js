const ITEMS = [
  { id: 'sandwich', name: 'Sandwich', price: 540 },
  { id: 'altavoz_portatil', name: 'Altavoz portatil', price: 300 },
  { id: 'altavoz_grande', name: 'Altavoz grande', price: 450 },
  { id: 'agua', name: 'Agua', price: 540 },
  { id: 'chocolate', name: 'Chocolate', price: 540 },
  { id: 'cerveza', name: 'Cerveza', price: 1800 },
  { id: 'radio', name: 'Radio', price: 750 },
  { id: 'rasca_y_gana', name: 'Rasca y gana', price: 300 },
  { id: 'viniculares', name: 'Viniculares', price: 600 },
  { id: 'camara', name: 'Camara', price: 600 },
  { id: 'telefono', name: 'Telefono', price: 300 },
  { id: 'bolsa_de_ropa', name: 'Bolsa de ropa', price: 600 },
  { id: 'fuegos_artificiales', name: 'Fuegos artificiales', price: 450 },
  { id: 'ganzua', name: 'Ganzua', price: 1500 },
  { id: 'buzo', name: 'Buzo', price: 6000 },
  { id: 'buzo_avanzado', name: 'Buzo avanzado', price: 12000 },
  { id: 'buzo_profesional', name: 'Buzo profesional', price: 18000 }
];

const ITEM_BY_ID = new Map(ITEMS.map((item) => [item.id, item]));

module.exports = { ITEMS, ITEM_BY_ID };
