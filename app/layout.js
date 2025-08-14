export const metadata = { title: "Skill Review" };

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto" }}>
        {children}
      </body>
    </html>
  );
}
