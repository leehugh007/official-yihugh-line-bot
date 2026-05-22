import Script from 'next/script';

// Microsoft Clarity project id is public browser config, not a secret.
const CLARITY_PROJECT_ID = 'wuxlgemk6l';

export default function ApplyLayout({ children }) {
  const enableClarity = process.env.VERCEL_ENV === 'production';

  return (
    <>
      {children}
      {enableClarity && (
        <Script id="clarity-tracker" strategy="afterInteractive">
          {`(function(c,l,a,r,i,t,y){
            c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
            t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
            y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
          })(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");`}
        </Script>
      )}
    </>
  );
}
