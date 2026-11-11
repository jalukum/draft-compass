import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource/lilita-one/latin-400.css';
import '@fontsource/rubik/latin-400.css';
import '@fontsource/rubik/latin-600.css';
import '@fontsource/rubik/latin-800.css';
import './styles.css';
import './theme-v2.css';
import { App } from './App';
import { APP } from './config';

document.title = `${APP.name} · ${APP.tagline}`;
render(<App />, document.getElementById('app')!);
if (import.meta.env.PROD) registerSW({ immediate: true });
