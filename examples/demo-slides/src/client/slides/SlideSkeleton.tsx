import { Layout } from '../../shared/slides'

/**
 * The shape of a layout before its content exists, shown as soon as Jev has
 * read the turn, while the LLM writes the slide.
 */
export default function SlideSkeleton({ layout }: { layout: Layout }) {
  return (
    <div className="slide flex w-full overflow-hidden bg-slate-900">
      <Shape layout={layout} />
    </div>
  )
}

function Shape({ layout }: { layout: Layout }) {
  switch (layout) {
    case 'title':
      return (
        <Center>
          <Block className="h-[6cqw] w-[60%]" />
          <Block className="h-[2.5cqw] w-[40%]" />
        </Center>
      )
    case 'section':
      return (
        <div className="flex w-full items-center px-[8cqw]">
          <Block className="h-[6cqw] w-[50%]" />
        </div>
      )
    case 'bullets':
      return (
        <Column>
          <Block className="h-[4cqw] w-[55%]" />
          {[80, 70, 75, 60].map((width) => (
            <Block
              key={width}
              className="mt-[2cqw] h-[2.4cqw]"
              style={{ width: `${width}%` }}
            />
          ))}
        </Column>
      )
    case 'image-left':
    case 'image-right':
      return (
        <div
          className={`flex w-full ${layout === 'image-right' ? 'flex-row-reverse' : ''}`}
        >
          <Block className="h-full w-1/2 rounded-none" />
          <div className="flex w-1/2 flex-col justify-center gap-[2cqw] px-[5cqw]">
            <Block className="h-[4cqw] w-[80%]" />
            <Block className="h-[2cqw] w-full" />
            <Block className="h-[2cqw] w-[90%]" />
          </div>
        </div>
      )
    case 'full-image':
      return (
        <div className="relative w-full">
          <Block className="absolute inset-0 rounded-none" />
          <Block className="absolute bottom-[5cqw] left-[6cqw] h-[5cqw] w-[50%]" />
        </div>
      )
    case 'quote':
      return (
        <Column className="justify-center px-[10cqw]">
          <Block className="h-[4cqw] w-full" />
          <Block className="mt-[1.5cqw] h-[4cqw] w-[70%]" />
          <Block className="mt-[3cqw] h-[2.2cqw] w-[25%]" />
        </Column>
      )
    case 'stats':
      return (
        <Column>
          <Block className="h-[4cqw] w-[50%]" />
          <div className="mt-auto grid grid-cols-3 gap-[3cqw]">
            {[0, 1, 2].map((index) => (
              <div key={index}>
                <Block className="h-[6cqw] w-[70%]" />
                <Block className="mt-[1cqw] h-[2cqw] w-full" />
              </div>
            ))}
          </div>
        </Column>
      )
    case 'two-columns':
      return (
        <Column>
          <Block className="h-[4cqw] w-[50%]" />
          <div className="mt-[4cqw] grid flex-1 grid-cols-2 gap-[4cqw]">
            <Block className="h-full" />
            <Block className="h-full" />
          </div>
        </Column>
      )
    case 'timeline':
      return (
        <Column>
          <Block className="h-[4cqw] w-[50%]" />
          <div className="mt-auto grid grid-cols-4 gap-[2cqw]">
            {[0, 1, 2, 3].map((index) => (
              <div key={index}>
                <Block className="h-[2cqw] w-[2cqw] rounded-full" />
                <Block className="mt-[1.5cqw] h-[2.4cqw] w-[80%]" />
                <Block className="mt-[0.8cqw] h-[1.7cqw] w-full" />
              </div>
            ))}
          </div>
        </Column>
      )
  }
}

function Block({
  className,
  style,
}: {
  className: string
  style?: React.CSSProperties
}) {
  return (
    <div className={`shimmer rounded-[0.8cqw] ${className}`} style={style} />
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-[2cqw]">
      {children}
    </div>
  )
}

function Column({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex w-full flex-col px-[6cqw] py-[6cqw] ${className}`}>
      {children}
    </div>
  )
}
