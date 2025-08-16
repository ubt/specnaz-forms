// Конфиг роута на Edge Runtime для страницы /form/[token]
export const runtime = 'edge';

export default function FormLayout({ children }) {
  return <>{children}</>;
}