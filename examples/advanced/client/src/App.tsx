import { PiCloudBold, PiDesktopBold } from 'react-icons/pi'
import CallDock from './components/CallDock'
import DetectionPanels from './components/DetectionPanels'
import DevicesPanel from './components/DevicesPanel'
import RailHeading from './components/RailHeading'
import ServerPanel from './components/ServerPanel'
import TopBar from './components/TopBar'
import Transcript from './components/Transcript'

/**
 * The workspace: settings on the left, the call on the right. On a wide
 * screen the server and browser settings sit side by side.
 *
 * The rail is sorted by where a setting acts rather than by what it is named,
 * because that is what decides whether moving it takes effect now or on the
 * next call. On a narrow screen the call comes first, since a phone is held to
 * talk into rather than to tune thresholds on.
 */
export default function App() {
  return (
    <div className="flex min-h-dvh flex-col bg-base text-main lg:h-dvh">
      <TopBar />

      {/*
        Below `lg` the page is one column that simply scrolls. From `lg` the
        page is locked to the viewport and every pane scrolls on its own, since
        a grid row told to fill a locked viewport collapses whatever sits in it
        on a phone. The server and browser settings share one rail until `xl`,
        where each gets its own column.
      */}
      <main
        className="mx-auto grid w-full max-w-[120rem] grid-cols-1 gap-4 p-4
          lg:min-h-0 lg:flex-1 lg:grid-cols-[24rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden
          xl:grid-cols-[44rem_minmax(0,1fr)] 2xl:grid-cols-[50rem_minmax(0,1fr)]"
      >
        <aside
          className="order-2 flex flex-col gap-3 lg:order-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1
            xl:grid xl:grid-cols-2 xl:gap-4 xl:overflow-hidden xl:pr-0"
        >
          <div className="flex flex-col gap-3 xl:min-h-0 xl:overflow-y-auto xl:pr-1">
            <RailHeading
              title="On the server"
              description="Applied on the next call"
              icon={<PiCloudBold className="h-3.5 w-3.5" />}
            />
            <ServerPanel />
          </div>

          <div className="flex flex-col gap-3 pt-2 xl:min-h-0 xl:overflow-y-auto xl:pt-0 xl:pr-1">
            <RailHeading
              title="In the browser"
              description="Applied right away"
              icon={<PiDesktopBold className="h-3.5 w-3.5" />}
            />
            <DevicesPanel />
            <DetectionPanels />
          </div>
        </aside>

        <section className="order-1 flex flex-col gap-3 lg:order-2 lg:min-h-0">
          <Transcript className="max-h-[60dvh] min-h-64 flex-1 lg:max-h-none" />
          <CallDock />
        </section>
      </main>
    </div>
  )
}
