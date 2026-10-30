// The sender's initial, square like every other box.
export function Avatar({ name }: { name: string }) {
  return (
    <div className="flex size-9 shrink-0 items-center justify-center bg-foreground/10 text-sm font-medium text-foreground/80">
      {name.charAt(0).toUpperCase()}
    </div>
  )
}
