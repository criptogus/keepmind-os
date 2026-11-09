import mark64 from '../../assets/brand/keepmind-mark-64.png';
import mark128 from '../../assets/brand/keepmind-mark-128.png';
export function BrandMark({ className = '', decorative = false }: { className?: string; decorative?: boolean }) {
    return <img className={`brand-logo ${className}`} src={mark64} srcSet={`${mark64} 1x, ${mark128} 2x`} alt={decorative ? '' : 'KeepMind'} aria-hidden={decorative ? true : undefined} />;
}
export function PoweredBy() {
    return <a className="powered-by" href="https://zeroagency.ai" onClick={event => { event.preventDefault(); void window.zaos.openExternal('https://zeroagency.ai').catch(console.error); }}>Powered by Zeroagency.ai</a>;
}
