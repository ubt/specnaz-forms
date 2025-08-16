// Конфиг роута на Edge Runtime для страницы /form/[token]
export const runtime = 'edge';
// Отключаем статическую генерацию для динамических страниц
export const dynamic = 'force-dynamic';
// Отключаем статический экспорт для этого маршрута
export const dynamicParams = true;

export default function FormLayout({ children }) {
  return <>{children}</>;
}