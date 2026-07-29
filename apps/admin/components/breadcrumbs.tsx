import Link from 'next/link';

export function Breadcrumbs({
  items,
}: {
  items: Array<{ label: string; href?: string }>;
}) {
  return (
    <nav className="breadcrumbs" aria-label="Trilha de navegação">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`}>
          {index > 0 && <span aria-hidden="true"> › </span>}
          {item.href ? <Link href={item.href}>{item.label}</Link> : item.label}
        </span>
      ))}
    </nav>
  );
}
