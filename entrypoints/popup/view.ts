// The "Popout" link and the sound picker in Settings open the popup page in a real tab,
// marked with ?view=tab.
export const isPopoutTab = new URLSearchParams(location.search).get('view') === 'tab'
