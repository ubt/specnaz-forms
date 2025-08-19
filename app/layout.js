import './globals.css';

export const metadata = { title: "Skill Review" };

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ 
        fontFamily: "system-ui, -apple-system, sans-serif", 
        maxWidth: 1200, 
        margin: "0 auto",
        backgroundColor: "#f8f9fa"
      }}>
        {children}
      </body>
    </html>
  );
}