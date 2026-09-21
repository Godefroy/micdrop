import { ReactNode } from 'react'
import { Slide } from '../../shared/slides'

/**
 * One slide, in its layout. Sizes are in `cqw`, a hundredth of the width of
 * the slide, so the same markup reads as a thumbnail or full screen.
 */
export default function SlideView({ slide }: { slide: Slide }) {
  switch (slide.layout) {
    case 'title':
      return (
        <Frame className="flex flex-col items-center justify-center gap-[2cqw] bg-gradient-to-br from-indigo-700 via-violet-700 to-fuchsia-700 px-[8cqw] text-center">
          <h1 className="text-[6.5cqw] font-bold leading-tight">
            {slide.title}
          </h1>
          {slide.subtitle && (
            <p className="text-[2.6cqw] text-white/80">{slide.subtitle}</p>
          )}
        </Frame>
      )

    case 'section':
      return (
        <Frame className="flex items-center bg-slate-900 px-[8cqw]">
          <div className="border-l-[0.8cqw] border-amber-400 pl-[3cqw]">
            <h2 className="text-[5.5cqw] font-bold leading-tight">
              {slide.title}
            </h2>
            {slide.subtitle && (
              <p className="mt-[1cqw] text-[2.4cqw] text-white/70">
                {slide.subtitle}
              </p>
            )}
          </div>
        </Frame>
      )

    case 'bullets':
      return (
        <Frame className="flex flex-col bg-slate-900 px-[7cqw] py-[6cqw]">
          <Title>{slide.title}</Title>
          <ul className="mt-[3cqw] flex flex-col gap-[1.8cqw]">
            {slide.bullets?.map((bullet, index) => (
              <li key={index} className="flex gap-[1.5cqw] text-[2.6cqw]">
                <span className="mt-[1cqw] h-[1cqw] w-[1cqw] shrink-0 rounded-full bg-amber-400" />
                {bullet}
              </li>
            ))}
          </ul>
        </Frame>
      )

    case 'image-left':
    case 'image-right':
      return (
        <Frame
          className={`flex bg-slate-900 ${
            slide.layout === 'image-right' ? 'flex-row-reverse' : ''
          }`}
        >
          <Picture slide={slide} className="h-full w-1/2" />
          <div className="flex w-1/2 flex-col justify-center gap-[2cqw] px-[5cqw]">
            <Title>{slide.title}</Title>
            {slide.body && (
              <p className="text-[2.2cqw] leading-relaxed text-white/80">
                {slide.body}
              </p>
            )}
          </div>
        </Frame>
      )

    case 'full-image':
      return (
        <Frame className="relative bg-slate-900">
          <Picture slide={slide} className="absolute inset-0" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          <h2 className="absolute bottom-[5cqw] left-[6cqw] right-[6cqw] text-[5cqw] font-bold leading-tight">
            {slide.title}
          </h2>
        </Frame>
      )

    case 'quote':
      return (
        <Frame className="flex flex-col justify-center bg-gradient-to-br from-slate-900 to-slate-800 px-[10cqw]">
          <p className="text-[4cqw] font-serif italic leading-snug">
            “{slide.quote ?? slide.title}”
          </p>
          {slide.author && (
            <p className="mt-[3cqw] text-[2.2cqw] text-amber-300">
              {slide.author}
            </p>
          )}
        </Frame>
      )

    case 'stats':
      return (
        <Frame className="flex flex-col bg-slate-900 px-[6cqw] py-[6cqw]">
          <Title>{slide.title}</Title>
          <div className="mt-auto grid grid-flow-col gap-[3cqw]">
            {slide.items?.map((item, index) => (
              <div key={index}>
                <p className="text-[6cqw] font-bold text-amber-400">
                  {item.title}
                </p>
                <p className="text-[2cqw] text-white/70">{item.text}</p>
              </div>
            ))}
          </div>
        </Frame>
      )

    case 'two-columns':
      return (
        <Frame className="flex flex-col bg-slate-900 px-[6cqw] py-[6cqw]">
          <Title>{slide.title}</Title>
          <div className="mt-[4cqw] grid flex-1 grid-cols-2 gap-[4cqw]">
            {slide.items?.slice(0, 2).map((item, index) => (
              <div key={index} className="rounded-[1.5cqw] bg-white/5 p-[3cqw]">
                <p className="text-[2.8cqw] font-semibold text-amber-300">
                  {item.title}
                </p>
                <p className="mt-[1.5cqw] text-[2cqw] leading-relaxed text-white/80">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </Frame>
      )

    case 'timeline':
      return (
        <Frame className="flex flex-col bg-slate-900 px-[6cqw] py-[6cqw]">
          <Title>{slide.title}</Title>
          <div className="relative mt-auto grid grid-flow-col gap-[2cqw] pt-[3cqw]">
            <div className="absolute left-0 right-0 top-[0.9cqw] h-[0.3cqw] bg-white/20" />
            {slide.items?.map((item, index) => (
              <div key={index} className="relative">
                <span className="absolute -top-[3cqw] h-[2cqw] w-[2cqw] rounded-full bg-amber-400" />
                <p className="text-[2.4cqw] font-semibold">{item.title}</p>
                <p className="mt-[0.8cqw] text-[1.7cqw] text-white/70">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </Frame>
      )
  }
}

function Frame({
  className,
  children,
}: {
  className: string
  children: ReactNode
}) {
  return (
    <div className={`slide w-full overflow-hidden text-white ${className}`}>
      {children}
    </div>
  )
}

function Title({ children }: { children: ReactNode }) {
  return <h2 className="text-[3.8cqw] font-bold leading-tight">{children}</h2>
}

/** The photo with its credit, or a gradient when none was found */
function Picture({ slide, className }: { slide: Slide; className: string }) {
  const { image } = slide
  if (!image) {
    return (
      <div
        className={`bg-gradient-to-br from-sky-800 to-indigo-900 ${className}`}
      />
    )
  }
  return (
    <div className={`relative ${className}`}>
      <img
        src={image.url}
        alt={image.alt}
        className="h-full w-full object-cover"
      />
      <a
        href={image.creditUrl}
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-[1cqw] right-[1cqw] rounded bg-black/50 px-[0.8cqw] text-[1.1cqw] text-white/80"
      >
        {image.credit}
      </a>
    </div>
  )
}
