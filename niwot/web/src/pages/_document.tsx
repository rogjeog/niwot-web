import Document, { Html, Head, Main, NextScript } from "next/document";

export default class MyDocument extends Document {
  render() {
    return (
      <Html lang="fr">
        <Head>
          {/* Favicon & Apple touch */}
          <link rel="icon" href="/niwot-favicon.png" type="image/png" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
          {/* Manifest */}
          <link rel="manifest" href="/site.webmanifest" />
          {/* Site name */}
          <meta name="application-name" content="niwot" />
          <meta name="apple-mobile-web-app-title" content="niwot" />
          <meta name="theme-color" content="#0b0b12" />
          <meta property="og:site_name" content="niwot" />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
