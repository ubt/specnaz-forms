export const runtime = 'edge';

// Простой «прокладочный» layout для сегмента /form/[token].
// Он серверный (без "use client"), поэтому Next примет конфиг runtime отсюда.
export default function FormLayout({ children }) {
  return <>{children}</>;
}
