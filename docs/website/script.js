const destinations = {
'new-york': {name:'New York',coordinates:'40.7128° N, 74.0060° W',left:'55%',top:'39%'},
paris: {name:'Paris',coordinates:'48.8566° N, 2.3522° E',left:'35%',top:'53%'},
tokyo: {name:'Tokyo',coordinates:'35.6762° N, 139.6503° E',left:'73%',top:'46%'}
};
document.querySelectorAll('[data-city]').forEach(button => {
button.addEventListener('click', () => {
const place = destinations[button.dataset.city];
document.querySelectorAll('[data-city]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
document.getElementById('place-name').textContent = place.name;
document.getElementById('map-caption').textContent = place.coordinates + ' · Illustrative preview';
Object.assign(document.getElementById('map-pin').style, {left:place.left,top:place.top});
});
});
document.getElementById('year').textContent = new Date().getFullYear();
