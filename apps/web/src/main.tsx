import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app';
import { SessionProvider } from './session';
import { UpdatePrompt } from './pwa';
import './styles.css';

const client=new QueryClient({defaultOptions:{queries:{
  staleTime:30_000,gcTime:60_000,retry:false,refetchOnWindowFocus:false,
}}});

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <QueryClientProvider client={client}>
      <SessionProvider><App/><UpdatePrompt/></SessionProvider>
    </QueryClientProvider>
  </BrowserRouter>,
);
