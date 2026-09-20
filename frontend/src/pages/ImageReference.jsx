import React from 'react';
import { useSearchParams } from 'react-router-dom';

const decodeImageUrl = (value) => {
  try {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    const url = new URL(atob(normalized + padding));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
};

const ImageReference = () => {
  const [searchParams] = useSearchParams();
  const imageUrl = decodeImageUrl(searchParams.get('i'));

  if (!imageUrl) {
    return <main style={styles.error}>Referência de imagem inválida ou indisponível.</main>;
  }

  return (
    <main style={styles.page}>
      <img src={imageUrl} alt="Referência do pedido" style={styles.image} />
      <a href={imageUrl} target="_blank" rel="noreferrer" style={styles.link}>Abrir imagem original</a>
    </main>
  );
};

const styles = {
  page: { minHeight: '100vh', padding: '24px', display: 'grid', placeItems: 'center', alignContent: 'center', gap: '16px', background: '#f4f7f5' },
  image: { maxWidth: 'min(100%, 1000px)', maxHeight: 'calc(100vh - 110px)', objectFit: 'contain', borderRadius: '14px', boxShadow: '0 18px 50px rgba(15, 23, 42, 0.18)' },
  link: { color: '#15803d', fontWeight: 800 },
  error: { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px', fontFamily: 'sans-serif' }
};

export default ImageReference;
