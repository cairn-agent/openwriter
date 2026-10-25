import React from 'react';
import ReactDOM from 'react-dom/client';

import { initAppearance } from './themes/appearance-store';
import { followSiteTypeStyle } from './themes/site-type-style';
import { RightRailProvider } from './right-rail/RightRailContext';
import './themes/vendored-fonts.css';
import './themes/colors-base.css';
import './themes/colors-extra.css';
import './themes/type-styles.css';
import './themes/canvas-styles.css';
import './tweet-compose/tweet-compose.css';
import './article-compose/ArticleComposeView.css';
import App from './App';
import './App.css';
// Last, so the shared rail type scale applies over each panel's own styles.
import './themes/rails.css';
import { loadClientPlugins } from './plugins/client-plugins';

initAppearance();
followSiteTypeStyle().catch(() => {});
void loadClientPlugins();

// RightRailProvider is hoisted above <App> (not nested inside App's return) so
// App itself can read rail open/width + push the responsive overlay flag down
// into the rail. Every rail consumer still sits under this single provider.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RightRailProvider>
      <App />
    </RightRailProvider>
  </React.StrictMode>
);
