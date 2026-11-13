import './globals.css';
import MockDataHost from './MockDataHost';

export const metadata = {
  title: 'Nam Sa-ard | Kiosk status',
  description: 'Live server heartbeat and connection status for a Nam Sa-ard water kiosk.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <MockDataHost />
        {children}
      </body>
    </html>
  );
}
