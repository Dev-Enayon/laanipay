export default function GlassCard({ children, className = '', glow = 'blue', hover = true }) {
  const glowClass = glow === 'neon' ? 'hover:shadow-neon' : 'hover:shadow-glow';
  return (
    <div
      className={`glass p-6 transition-all duration-300 ${
        hover ? `hover:-translate-y-1.5 ${glowClass}` : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}
