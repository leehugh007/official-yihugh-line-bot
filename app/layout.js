import Script from 'next/script';

export const metadata = {
  title: '一休官方 LINE Bot',
};

// Microsoft Clarity — session recording / heatmap / scroll depth
// 只在 production 啟用，避免 dev 環境污染數據。Project ID 是公開值（會送到瀏覽器），不算 secret。
const CLARITY_PROJECT_ID = 'wuxlgemk6l';

export default function RootLayout({ children }) {
  return (
    <html lang="zh-TW">
      <body>
        {children}
        {process.env.NODE_ENV === 'production' && (
          <Script id="clarity-tracker" strategy="afterInteractive">
            {`(function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");`}
          </Script>
        )}
      </body>
    </html>
  );
}