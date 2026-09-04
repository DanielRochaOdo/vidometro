import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vidômetro Odontoart",
  description: "Contador e histórico de vidas ativas da Odontoart"
};

const themeScript = `
  try {
    const saved = localStorage.getItem('vidometro-theme');
    const dark = saved ? saved === 'dark' : true;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch {}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
