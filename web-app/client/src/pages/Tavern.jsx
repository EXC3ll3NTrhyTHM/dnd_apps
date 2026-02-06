import { useState, useEffect } from 'react';
import { api } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import ItemCard from '../components/ItemCard';
import Toast from '../components/Toast';
import '../styles/tavern.css';

export default function Tavern() {
  const { wallet, refreshWallet } = useAuth();
  const [menu, setMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buyingId, setBuyingId] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    loadMenu();
  }, []);

  async function loadMenu() {
    try {
      const data = await api('/api/tavern/menu');
      setMenu(data);
    } catch (err) {
      console.error('Failed to load tavern menu:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleBuy(item) {
    setBuyingId(item.id);
    try {
      const result = await api('/api/tavern/buy', {
        method: 'POST',
        body: JSON.stringify({ item_id: item.id })
      });

      if (result.success) {
        refreshWallet({ ...wallet, balance: result.balance });
        setToast({
          message: result.item.flavor_text || `You ordered ${item.name}!`,
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
        <p>Loading the menu...</p>
      </div>
    );
  }

  if (!menu) {
    return <div className="page-error">Failed to load the tavern menu.</div>;
  }

  return (
    <div className="page tavern-page">
      <div className="page-header">
        <h1 className="page-title">🍺 {menu.tavern_name || "The Dragon's Hollow"}</h1>
        <p className="page-subtitle">Big Tam's place. Sit down, order something.</p>
      </div>

      {Object.entries(menu.categories).map(([key, category]) => (
        <section key={key} className="menu-section">
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
