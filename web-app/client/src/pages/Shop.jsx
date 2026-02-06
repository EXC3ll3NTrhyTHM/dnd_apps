import { useState, useEffect } from 'react';
import { api } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import ItemCard from '../components/ItemCard';
import Toast from '../components/Toast';
import '../styles/shop.css';

export default function Shop() {
  const { wallet, refreshWallet } = useAuth();
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buyingId, setBuyingId] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    loadCatalog();
  }, []);

  async function loadCatalog() {
    try {
      const data = await api('/api/shop/catalog');
      setCatalog(data);
    } catch (err) {
      console.error('Failed to load shop catalog:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleBuy(item) {
    setBuyingId(item.id);
    try {
      const result = await api('/api/shop/buy', {
        method: 'POST',
        body: JSON.stringify({ item_id: item.id })
      });

      if (result.success) {
        refreshWallet({ ...wallet, balance: result.balance });
        setToast({
          message: `Purchased ${item.name}! Grumm grunts approvingly.`,
          type: 'success'
        });
      }
    } catch (err) {
      setToast({
        message: err.data?.error || 'Purchase failed',
        type: 'error'
      });
    } finally {
      setBuyingId(null);
    }
  }

  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner" />
        <p>Grumm is arranging his wares...</p>
      </div>
    );
  }

  if (!catalog) {
    return <div className="page-error">The shop is closed.</div>;
  }

  return (
    <div className="page shop-page">
      <div className="page-header">
        <h1 className="page-title">🛒 Grumm's Shop</h1>
        <p className="page-subtitle">Browse. Buy. Don't touch anything unless you're paying.</p>
      </div>

      {Object.entries(catalog.categories).map(([key, category]) => (
        <section key={key} className="shop-section">
          <h2 className="section-title">
            <span className="section-emoji">{category.emoji}</span>
            {category.display_name}
          </h2>
          <div className="items-grid">
            {category.items.map(item => (
              <ItemCard
                key={item.id}
                item={item}
                onBuy={handleBuy}
                buying={buyingId === item.id}
                disabled={wallet && wallet.balance < item.price}
              />
            ))}
          </div>
        </section>
      ))}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
