import type { MenuItemConstructorOptions } from 'electron';
/** Explicit labels follow the app language rather than the host OS language. */
export function nativeMenuTemplate(language: string, mac: boolean): MenuItemConstructorOptions[] {
  const text = (en: string, pt: string) => language === 'pt' ? pt : en;
  return [
    ...(mac ? [{label:'KeepMind OS',submenu:[{role:'about' as const,label:text('About KeepMind OS','Sobre o KeepMind OS')},{type:'separator' as const},{role:'hide' as const,label:text('Hide KeepMind OS','Ocultar KeepMind OS')},{role:'unhide' as const,label:text('Show all','Mostrar tudo')},{type:'separator' as const},{role:'quit' as const,label:text('Quit KeepMind OS','Sair do KeepMind OS')}]}] : []),
    {label:text('File','Arquivo'),submenu:[{role:'close',label:text('Close window','Fechar janela')},...(!mac ? [{role:'quit' as const,label:text('Quit','Sair')}] : [])]},
    {label:text('Edit','Editar'),submenu:[{role:'undo',label:text('Undo','Desfazer')},{role:'redo',label:text('Redo','Refazer')},{type:'separator'},{role:'cut',label:text('Cut','Recortar')},{role:'copy',label:text('Copy','Copiar')},{role:'paste',label:text('Paste','Colar')},{role:'selectAll',label:text('Select all','Selecionar tudo')}]},
    {label:text('View','Visualizar'),submenu:[{role:'reload',label:text('Reload','Recarregar')},{role:'resetZoom',label:text('Actual size','Tamanho original')},{role:'zoomIn',label:text('Zoom in','Ampliar')},{role:'zoomOut',label:text('Zoom out','Reduzir')},{role:'togglefullscreen',label:text('Toggle full screen','Alternar tela cheia')},{role:'toggleDevTools',label:text('Developer tools','Ferramentas de desenvolvimento')}]},
    {label:text('Window','Janela'),submenu:[{role:'minimize',label:text('Minimize','Minimizar')},{role:'zoom',label:text('Zoom','Ampliar janela')}]},
  ];
}
