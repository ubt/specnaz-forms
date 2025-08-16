// Убираем export const runtime = 'edge' из layout
// Layout файлы не должны экспортировать runtime config в Cloudflare

export default function FormLayout({ children }) {
  return <>{children}</>;
}