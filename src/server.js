require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const basicAuth = require('express-basic-auth');

const PORT = process.env.PORT || 4000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';

// In-memory data storage
let menuData = {
  categories: [
    { id: 1, name: 'Burgers', icon: '🍔', sort_order: 1, active: true },
    { id: 2, name: 'Sides', icon: '🍟', sort_order: 2, active: true },
    { id: 3, name: 'Drinks', icon: '🥤', sort_order: 3, active: true }
  ],
  items: [
    {
      id: 1,
      name: { en: 'Classic Burger', mt: 'Burger Klassiku', it: 'Burger Classico', fr: 'Burger Classique', es: 'Burger Clásico', de: 'Klassischer Burger', ru: 'Классический бургер', pt: 'Burger Clássico', nl: 'Klassieke Burger', pl: 'Klasyczny Burger' },
      description: { en: 'Juicy beef patty with fresh lettuce and tomato', mt: 'Patty tal-baħar b\'lettuce friska u tadam', it: 'Polpetta di manzo succosa con lattuga fresca e pomodoro', fr: 'Steak de bœuf juteux avec laitue fraîche et tomate', es: 'Hamburguesa de carne jugosa con lechuga fresca y tomate', de: 'Saftiges Rindersteak mit frischem Salat und Tomate', ru: 'Сочная говяжья котлета со свежим салатом и помидорами', pt: 'Hambúrguer de carne suculento com alface fresca e tomate', nl: 'Sappige rundvleesburger met verse sla en tomaat', pl: 'Soczysta wołowina z świeżą sałatą i pomidorem' },
      price: 12.99,
      image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400',
      category_id: 1,
      active: true,
      ingredients: { en: 'Beef patty, lettuce, tomato, onion, bun', mt: 'Patty tal-baħar, lettuce, tadam, basal, bun', it: 'Polpetta di manzo, lattuga, pomodoro, cipolla, panino', fr: 'Steak de bœuf, laitue, tomate, oignon, pain', es: 'Hamburguesa de carne, lechuga, tomate, cebolla, pan', de: 'Rindersteak, Salat, Tomate, Zwiebel, Brötchen', ru: 'Говяжья котлета, салат, помидор, лук, булочка', pt: 'Hambúrguer de carne, alface, tomate, cebola, pão', nl: 'Rundvleesburger, sla, tomaat, ui, broodje', pl: 'Wołowina, sałata, pomidor, cebula, bułka' },
      nutrition: { en: 'Calories: 650, Protein: 35g, Carbs: 45g, Fat: 35g', mt: 'Kaloriji: 650, Proteini: 35g, Karboidrati: 45g, Xaħmijiet: 35g', it: 'Calorie: 650, Proteine: 35g, Carboidrati: 45g, Grassi: 35g', fr: 'Calories: 650, Protéines: 35g, Glucides: 45g, Lipides: 35g', es: 'Calorías: 650, Proteínas: 35g, Carbohidratos: 45g, Grasas: 35g', de: 'Kalorien: 650, Eiweiß: 35g, Kohlenhydrate: 45g, Fette: 35g', ru: 'Калории: 650, Белки: 35г, Углеводы: 35г, Жиры: 35г', pt: 'Calorias: 650, Proteínas: 35g, Carboidratos: 45g, Gorduras: 35g', nl: 'Calorieën: 650, Eiwit: 35g, Koolhydraten: 45g, Vet: 35g', pl: 'Kalorie: 650, Białko: 35g, Węglowodany: 45g, Tłuszcz: 35g' },
      allergies: { en: 'Contains gluten, dairy', mt: 'Fih gluten, dairy', it: 'Contiene glutine, latticini', fr: 'Contient du gluten, des produits laitiers', es: 'Contiene gluten, lácteos', de: 'Enthält Gluten, Milchprodukte', ru: 'Содержит глютен, молочные продукты', pt: 'Contém glúten, laticínios', nl: 'Bevat gluten, zuivel', pl: 'Zawiera gluten, nabiał' },
      prepTime: { en: '15 min', mt: '15 min', it: '15 min', fr: '15 min', es: '15 min', de: '15 Min', ru: '15 мин', pt: '15 min', nl: '15 min', pl: '15 min' }
    },
    {
      id: 2,
      name: { en: 'Crispy Fries', mt: 'Pata Crispy', it: 'Patatine Croccanti', fr: 'Frites Croustillantes', es: 'Papas Crujientes', de: 'Knusprige Pommes', ru: 'Хрустящий картофель фри', pt: 'Batatas Crocantes', nl: 'Knapperige Frietjes', pl: 'Chrupiące Frytki' },
      description: { en: 'Golden crispy fries with sea salt and herbs', mt: 'Pata dehbi u crisp bi melħ tal-baħar u ħwawar', it: 'Patatine dorate e croccanti con sale marino ed erbe', fr: 'Frites dorées et croustillantes avec sel de mer et herbes', es: 'Papas doradas y crujientes con sal marina y hierbas', de: 'Goldene knusprige Pommes mit Meersalz und Kräutern', ru: 'Золотистый хрустящий картофель фри с морской солью и травами', pt: 'Batatas douradas e crocantes com sal marinho e ervas', nl: 'Gouden knapperige frietjes met zeezout en kruiden', pl: 'Złote chrupiące frytki z solą morską i ziołami' },
      price: 3.50,
      image: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=400',
      category_id: 2,
      active: true,
      ingredients: { en: 'Potatoes, Sea salt, Herbs, Vegetable oil', mt: 'Patata, Melħ tal-baħar, Ħwawar, Żejt tal-ħxejjex', it: 'Patate, Sale marino, Erbe, Olio vegetale', fr: 'Pommes de terre, Sel de mer, Herbes, Huile végétale', es: 'Papas, Sal marina, Hierbas, Aceite vegetal', de: 'Kartoffeln, Meersalz, Kräuter, Pflanzenöl', ru: 'Картофель, Морская соль, Травы, Растительное масло', pt: 'Batatas, Sal marinho, Ervas, Óleo vegetal', nl: 'Aardappelen, Zeezout, Kruiden, Plantaardige olie', pl: 'Ziemniaki, Sól morska, Zioła, Olej roślinny' },
      nutrition: { en: 'Calories: 320, Protein: 4g, Carbs: 42g, Fat: 14g', mt: 'Kaloriji: 320, Proteini: 4g, Karboidrati: 42g, Xaħmijiet: 14g', it: 'Calorie: 320, Proteine: 4g, Carboidrati: 42g, Grassi: 14g', fr: 'Calories: 320, Protéines: 4g, Glucides: 42g, Lipides: 14g', es: 'Calorías: 320, Proteínas: 4g, Carbohidratos: 42g, Grasas: 14g', de: 'Kalorien: 320, Eiweiß: 4g, Kohlenhydrate: 42g, Fette: 14g', ru: 'Калории: 320, Белки: 4г, Углеводы: 42г, Жиры: 14г', pt: 'Calorias: 320, Proteínas: 4g, Carboidratos: 42g, Gorduras: 14g', nl: 'Calorieën: 320, Eiwit: 4g, Koolhydraten: 42g, Vet: 14g', pl: 'Kalorie: 320, Białko: 4g, Węglowodany: 42g, Tłuszcz: 14g' },
      allergies: { en: 'None', mt: 'Xejn', it: 'Nessuno', fr: 'Aucun', es: 'Ninguno', de: 'Keine', ru: 'Нет', pt: 'Nenhuma', nl: 'Geen', pl: 'Brak' },
      prepTime: { en: '8-10 min', mt: '8-10 min', it: '8-10 min', fr: '8-10 min', es: '8-10 min', de: '8-10 Min', ru: '8-10 мин', pt: '8-10 min', nl: '8-10 min', pl: '8-10 min' }
    },
    {
      id: 3,
      name: { en: 'Fresh Cola', mt: 'Cola Friska', it: 'Cola Fresca', fr: 'Cola Fraîche', es: 'Cola Fresca', de: 'Frische Cola', ru: 'Свежая кола', pt: 'Cola Fresca', nl: 'Verse Cola', pl: 'Świeża Cola' },
      description: { en: 'Classic cola with a refreshing twist', mt: 'Cola klassika b\'bidla ferraħ', it: 'Cola classica con un tocco rinfrescante', fr: 'Cola classique avec une touche rafraîchissante', es: 'Cola clásica con un toque refrescante', de: 'Klassische Cola mit einem erfrischenden Twist', ru: 'Классическая кола с освежающим оттенком', pt: 'Cola clássica com um toque refrescante', nl: 'Klassieke cola met een verfrissende twist', pl: 'Klasyczna cola z orzeźwiającym akcentem' },
      price: 2.50,
      image: 'https://images.unsplash.com/photo-1581636625402-29b2a704ef13?w=400',
      category_id: 3,
      active: true,
      ingredients: { en: 'Carbonated water, Natural flavors, Caffeine', mt: 'Ilma karbonat, Fwejjaħ naturali, Kafeina', it: 'Acqua gassata, Aromi naturali, Caffeina', fr: 'Eau gazéifiée, Arômes naturels, Caféine', es: 'Agua carbonatada, Sabores naturales, Cafeína', de: 'Kohlensäurehaltiges Wasser, Natürliche Aromen, Koffein', ru: 'Газированная вода, Натуральные ароматизаторы, Кофеин', pt: 'Água gaseificada, Sabores naturais, Cafeína', nl: 'Koolzuurhoudend water, Natuurlijke smaken, Cafeïne', pl: 'Woda gazowana, Naturalne aromaty, Kofeina' },
      nutrition: { en: 'Calories: 140, Protein: 0g, Carbs: 35g, Fat: 0g', mt: 'Kaloriji: 140, Proteini: 0g, Karboidrati: 35g, Xaħmijiet: 0g', it: 'Calorie: 140, Proteine: 0g, Carboidrati: 35g, Grassi: 0g', fr: 'Calories: 140, Protéines: 0g, Glucides: 35g, Lipides: 0g', es: 'Calorías: 140, Proteínas: 0g, Carbohidratos: 35g, Grasas: 0g', de: 'Kalorien: 140, Eiweiß: 0g, Kohlenhydrate: 35g, Fette: 0g', ru: 'Калории: 140, Белки: 0г, Углеводы: 35г, Жиры: 0г', pt: 'Calorias: 140, Proteínas: 0g, Carboidratos: 35g, Gorduras: 0g', nl: 'Calorieën: 140, Eiwit: 0g, Koolhydraten: 35g, Vet: 0g', pl: 'Kalorie: 140, Białko: 0g, Węglowodany: 35g, Tłuszcz: 0g' },
      allergies: { en: 'None', mt: 'Xejn', it: 'Nessuno', fr: 'Aucun', es: 'Ninguno', de: 'Keine', ru: 'Нет', pt: 'Nenhuma', nl: 'Geen', pl: 'Brak' },
      prepTime: { en: '1 min', mt: '1 min', it: '1 min', fr: '1 min', es: '1 min', de: '1 Min', ru: '1 мин', pt: '1 min', nl: '1 min', pl: '1 min' }
    }
  ]
};

let orders = [];
let orderIdCounter = 1;

const app = express();

// Middleware - Allow all origins for now (you can restrict later)
app.use(cors({ 
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Basic auth for admin routes
const authMiddleware = basicAuth({
  users: { [ADMIN_USER]: ADMIN_PASS },
  challenge: true,
  realm: 'Admin Area'
});

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'AROMA Restaurant API',
    status: 'running',
    version: '1.0.0',
    endpoints: {
      menu: '/api/menu',
      settings: '/api/settings',
      orders: '/api/orders',
      admin: '/admin',
      health: '/health'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Routes
app.get('/api/menu', (req, res) => {
  res.json(menuData);
});

app.get('/api/settings', (req, res) => {
  res.json({
    restaurantName: 'AROMA Restaurant',
    currency: 'EUR',
    taxRate: 0.18,
    serviceCharge: 0.10,
    deliveryFee: 2.50
  });
});

app.post('/api/orders', (req, res) => {
  try {
    const { items, orderType, tableNumber, customerName, total } = req.body;
    
    const newOrder = {
      id: orderIdCounter++,
      items: items.map(item => {
        const menuItem = menuData.items.find(i => i.id === item.id);
        return {
          id: item.id,
          name: menuItem ? menuItem.name : 'Unknown Item',
          price: menuItem ? menuItem.price : 0,
          qty: item.qty
        };
      }),
      orderType,
      tableNumber: tableNumber || null,
      customerName: customerName || 'Walk-in Customer',
      total,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    
    orders.push(newOrder);
    res.json({ success: true, orderId: newOrder.id });
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});

// Admin Routes
app.get('/admin', authMiddleware, (req, res) => {
  const pending = orders.filter(o => o.status === 'pending').length;
  const confirmed = orders.filter(o => o.status === 'confirmed').length;
  const totalSales = orders.reduce((sum, order) => sum + order.total, 0);
  
  res.json({
    stats: { pending, confirmed, totalSales },
    recentOrders: orders.slice(-5).reverse()
  });
});

app.get('/admin/orders', authMiddleware, (req, res) => {
  res.json(orders);
});

app.post('/admin/orders/:id/status', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  const order = orders.find(o => o.id === parseInt(id));
  if (order) {
    order.status = status;
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Order not found' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AROMA Backend running on port ${PORT}`);
  console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
