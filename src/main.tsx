import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import './simple.css';
import { App } from './App';
import { APP } from './config';

document.title = `${APP.name} · ${APP.tagline}`;
render(<App />, document.getElementById('app')!);
if (import.meta.env.PROD) registerSW({ immediate: true });
