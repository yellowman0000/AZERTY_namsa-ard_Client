export const metadata = {
  title: 'Prepaid Water Kiosk - Operator Node',
  description: 'Nam Sa-ard Water Kiosk Client Operator Node',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}