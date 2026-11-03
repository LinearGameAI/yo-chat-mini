// Unchanged paths from the App's primitives/YIcon/ShortDramaPlayFill,
// ShortFullscreen and ShortMorescreen. These three are not in rn-icon yet.
export function DramaPlayerIcon({ name, size = 24 }: { name: 'play' | 'expand' | 'collapse'; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {name === 'play' ? <path d="M7.5 22.9597C7.5 23.3789 7.98497 23.612 8.31235 23.3501L22.012 12.3904C22.2622 12.1903 22.2622 11.8097 22.012 11.6096L8.31235 0.649878C7.98497 0.387973 7.5 0.621059 7.5 1.04031L7.5 22.9597Z" />
      : <>{name === 'expand' ? <><path d="M7.25 7.25V11H5L5 5L11 5V7.25H7.25Z" /><path d="M13 19V16.75H16.75V13H19V19H13Z" /></>
        : <><path d="M5 11V8.75L8.75 8.75L8.75 5H11V11H5Z" /><path d="M15.25 15.25V19H13V13H19V15.25H15.25Z" /></>}
      <path fillRule="evenodd" clipRule="evenodd" d="M1 23L1 1L23 1L23 23L1 23ZM3.2002 3.2002L3.2002 20.7998H20.7998V3.2002L3.2002 3.2002Z" /></>}
  </svg>;
}
