import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vidômetro Odontoart",
  description: "Contador e histórico de vidas ativas da Odontoart"
};

const themeScript = `
  try {
    const saved = localStorage.getItem('vidometro-theme');
    const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch {}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
