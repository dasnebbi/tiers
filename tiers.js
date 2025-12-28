/*
	Offline Tierlist Maker
	Copyright (C) 2022  silverweed

 Everyone is permitted to copy and distribute verbatim or modified
 copies of this license document, and changing it is allowed as long
 as the name is changed.

            DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
   TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION

  0. You just DO WHAT THE FUCK YOU WANT TO.
*/

'use strict';

const MAX_NAME_LEN = 200;
const DEFAULT_TIERS = ['Meisterwerk','Wow','Stark','Joa.','Schnappschuss','Missraten'];
const TIER_COLORS = [
	// from S to F
	'#ff6666',
	'#f0a731',
	'#f4d95b',
	'#66ff66',
	'#58c8f4',
	'#5b76f4',
	'#f45bed'
];

let unique_id = 0;

let unsaved_changes = false;

const LAYOUT_HORIZONTAL = 0;
const LAYOUT_VERTICAL = 1;
let cur_layout = LAYOUT_HORIZONTAL;

// Contains [[header, input, label]]
let all_headers = [];
let headers_orig_min_width;

// DOM elems
let untiered_images;
let tierlist_div;
let dragged_image;
let preview_image;
let preview_placeholder;
let preview_panel;
let preview_exif;
let preview_exif_token = 0;
const preview_exif_cache = new Map();

// Used in drop() logic for placing items within a tier
let old_item_index;

// Used to add and remove the placement marker
let placement_marker_div;

function reset_row(row) {
	row.querySelectorAll('span.item').forEach((item) => {
		for (let i = 0; i < item.children.length; ++i) {
			let img = item.children[i];
			item.removeChild(img);
			untiered_images.appendChild(img);
		}
		item.parentNode.removeChild(item);
	});
}

// Removes all rows from the tierlist, alongside their content.
// Also empties the untiered images.
function hard_reset_list() {
	tierlist_div.innerHTML = '';
	untiered_images.innerHTML = '';
}

// Places back all the tierlist content into the untiered pool.
function soft_reset_list() {
	tierlist_div.querySelectorAll('.row').forEach(reset_row);
	unsaved_changes = true;
}

window.addEventListener('load', () => {
	untiered_images =  document.querySelector('.images');
	tierlist_div =  document.querySelector('.tierlist');
	preview_image = document.getElementById('preview-image');
	preview_placeholder = document.querySelector('.preview-placeholder');
	preview_panel = document.querySelector('.preview-panel');
	preview_exif = document.querySelector('.preview-exif');

	set_preview_image(null);

	for (let i = 0; i < DEFAULT_TIERS.length; ++i) {
		add_row(i, DEFAULT_TIERS[i]);
	}
	recompute_header_colors();

	headers_orig_min_width = all_headers[0][0].clientWidth;

	make_accept_drop(document.querySelector('.images'));

	bind_title_events();

	document.getElementById('load-img-input').addEventListener('input', (evt) => {
		// @Speed: maybe we can do some async stuff to optimize this
		let images = document.querySelector('.images');
		for (let file of evt.target.files) {
			let reader = new FileReader();
			reader.addEventListener('load', (load_evt) => {
				let img = create_img_with_src(load_evt.target.result);
				images.appendChild(img);
				unsaved_changes = true;
			});
			reader.readAsDataURL(file);
		}
	});

	// Allow copy-pasting image from clipboard
	document.onpaste = (evt) => {
		let clip_data = evt.clipboardData || evt.originalEvent.clipboardData;
		let items = clip_data.items;
		let images = document.querySelector('.images');
		for (let item of items) {
			if (item.kind === 'file') {
				let blob = item.getAsFile();
				let reader = new FileReader();
				reader.onload = (load_evt) => {
					let img = create_img_with_src(load_evt.target.result);
					images.appendChild(img);
					unsaved_changes = true;
				};
				reader.readAsDataURL(blob);
			}
		}
	};

	document.getElementById('reset-list-input').addEventListener('click', () => {
		if (confirm('Reset Tierlist? (this will place all images back in the pool)')) {
			soft_reset_list();
		}
	});

	document.getElementById('export-input').addEventListener('click', () => {
		let name = prompt('Please give a name to this tierlist');
		if (name) {
			save_tierlist(`${name}.json`);
		}
	});

	document.getElementById('import-input').addEventListener('input', (evt) => {
		if (!evt.target.files) {
			return;
		}
		let file = evt.target.files[0];
		let reader = new FileReader();
		reader.addEventListener('load', (load_evt) => {
			let raw = load_evt.target.result;
			let parsed = JSON.parse(raw);
			if (!parsed) {
				alert("Failed to parse data");
				return;
			}
			hard_reset_list();
			load_tierlist(parsed);
		});
		reader.readAsText(file);
		});

	bind_trash_events();
	bind_toggle_layout_events();

	document.addEventListener('click', (evt) => {
		if (evt.target.closest('.preview-panel')) {
			return;
		}
		if (!evt.target.closest('img.draggable')) {
			set_preview_image(null);
		}
	});

	window.addEventListener('beforeunload', (evt) => {
		if (!unsaved_changes) return null;
		var msg = "You have unsaved changes. Leave anyway?";
		(evt || window.event).returnValue = msg;
		return msg;
	});

	void try_load_tierlist_json();
});

function set_preview_image(src) {
	if (!preview_image || !preview_placeholder) return;
	const token = ++preview_exif_token;

	if (!src) {
		preview_image.src = '';
		preview_image.style.display = 'none';
		preview_placeholder.style.display = 'block';
		preview_panel?.classList.add('hidden');
		clear_preview_exif();
		return;
	}

	preview_image.src = src;
	preview_image.style.display = 'block';
	preview_placeholder.style.display = 'none';
	preview_panel?.classList.remove('hidden');
	const cached = preview_exif_cache.get(src);
	if (cached !== undefined) {
		if (preview_exif) {
			preview_exif.textContent = cached;
		}
		return;
	}
	set_preview_exif_loading();
	update_preview_exif(src, token);
}

function clear_preview_for_dragged_image() {
	if (dragged_image && preview_image && preview_image.src === dragged_image.src) {
		set_preview_image(next_pool_image_src());
	}
}

function clear_preview_exif() {
	if (!preview_exif) return;
	preview_exif.textContent = '';
}

function set_preview_exif_loading() {
	if (!preview_exif) return;
	preview_exif.textContent = 'EXIF-Daten werden geladen...';
}

function next_pool_image_src() {
	if (!untiered_images) return null;
	const poolImages = Array.from(untiered_images.querySelectorAll('img'));
	if (poolImages.length === 0) return null;
	const currentIdx = poolImages.findIndex((img) => img.src === preview_image?.src);
	if (currentIdx === -1) return poolImages[0].src;
	return poolImages[(currentIdx + 1) % poolImages.length].src;
}

function normalize_make(make) {
	if (!make || typeof make !== 'string') return '';
	let cleaned = make.replace(/corporation/ig, '')
		.replace(/inc\.?/ig, '')
		.replace(/co\.,?\s*ltd\.?/ig, '')
		.replace(/co\.?/ig, '');
	cleaned = cleaned.trim().toLowerCase();
	if (!cleaned) return '';
	return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function normalize_model(model, make) {
	if (!model || typeof model !== 'string') return '';
	let cleaned = model.trim();
	if (make) {
		const prefix = new RegExp(`^${make}\\s+`, 'i');
		cleaned = cleaned.replace(prefix, '').trim();
	}
	return cleaned;
}

function pick_first(value) {
	return Array.isArray(value) ? value[0] : value;
}

function rational_to_number(rat) {
	if (!rat || rat.denominator === 0) return null;
	return rat.numerator / rat.denominator;
}

function format_exposure_time(exposure_time, shutter_speed_value) {
	let seconds = null;
	if (exposure_time) {
		seconds = rational_to_number(exposure_time);
	} else if (shutter_speed_value) {
		const sv = rational_to_number(shutter_speed_value);
		if (sv !== null) {
			seconds = Math.pow(2, -sv);
		}
	}
	if (seconds === null || seconds === 0) return null;
	if (seconds >= 1) {
		return `${seconds.toFixed(2)}s`;
	}
	return `1/${Math.round(1 / seconds)}s`;
}

function format_date(date_str) {
	if (!date_str || typeof date_str !== 'string') return null;
	const parts = date_str.trim().split(' ')[0];
	if (!parts) return null;
	return parts.replace(/:/g, '-');
}

function format_exif(tags) {
	if (!tags) return '';
	const make = normalize_make(pick_first(tags[0x010F])) || '';
	const model_raw = pick_first(tags[0x0110]) || '';
	const model = normalize_model(model_raw, make);
	const lens = pick_first(tags[0xA434]) || '';
	const lens_make = normalize_make(pick_first(tags[0xA433])) || '';
	const focal_length = rational_to_number(pick_first(tags[0x920A]));
	const f_number = rational_to_number(pick_first(tags[0x829D]));
	const exposure_time = pick_first(tags[0x829A]);
	const shutter_speed_value = pick_first(tags[0x9201]);
	const iso = pick_first(tags[0x8827]) || pick_first(tags[0x8833]);
	const date_original = pick_first(tags[0x9003]);

	const camera_desc = [make, model].filter(Boolean).join(' ').trim();
	const lens_desc = lens || lens_make;
	const line1 = [camera_desc, lens_desc].filter(Boolean).join(' + ');

	const pieces_line2 = [];
	if (focal_length) pieces_line2.push(`${focal_length.toFixed(0)}mm`);
	if (f_number) pieces_line2.push(`f/${f_number.toFixed(1)}`);
	const exposure_str = format_exposure_time(exposure_time, shutter_speed_value);
	if (exposure_str) pieces_line2.push(exposure_str);
	if (iso) pieces_line2.push(`ISO ${iso}`);
	const line2 = pieces_line2.join(', ');

	const line3 = format_date(date_original);

	return [line1, line2, line3].filter(Boolean).join('\n');
}

function read_ascii(view, start, count) {
	let out = '';
	for (let i = 0; i < count - 1; i++) {
		out += String.fromCharCode(view.getUint8(start + i));
	}
	return out.trim();
}

function read_rational(view, start, littleEndian, signed = false) {
	const numerator = signed ? view.getInt32(start, littleEndian) : view.getUint32(start, littleEndian);
	const denominator = signed ? view.getInt32(start + 4, littleEndian) : view.getUint32(start + 4, littleEndian);
	return { numerator, denominator };
}

function get_tag_value(view, tiff_start, entry_offset, type, count, value_offset, littleEndian) {
	const type_sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 10: 8 };
	const size = type_sizes[type];
	if (!size) return null;
	let value_ptr;
	if (count * size <= 4) {
		value_ptr = entry_offset + 8;
	} else {
		value_ptr = tiff_start + value_offset;
	}

	const read_value = (offset) => {
		switch (type) {
			case 1:
			case 7:
				return view.getUint8(offset);
			case 2:
				return read_ascii(view, offset, count);
			case 3:
				return view.getUint16(offset, littleEndian);
			case 4:
				return view.getUint32(offset, littleEndian);
			case 5:
				return read_rational(view, offset, littleEndian, false);
			case 10:
				return read_rational(view, offset, littleEndian, true);
			default:
				return null;
		}
	};

	if (type === 2) {
		return read_value(value_ptr);
	}

	if (count === 1) {
		return read_value(value_ptr);
	}
	const values = [];
	for (let i = 0; i < count; i++) {
		values.push(read_value(value_ptr + i * size));
	}
	return values;
}

function parse_ifd(view, tiff_start, offset, littleEndian, tags) {
	const entries = view.getUint16(tiff_start + offset, littleEndian);
	for (let i = 0; i < entries; i++) {
		const entry_offset = tiff_start + offset + 2 + i * 12;
		const tag = view.getUint16(entry_offset, littleEndian);
		const type = view.getUint16(entry_offset + 2, littleEndian);
		const count = view.getUint32(entry_offset + 4, littleEndian);
		const value_offset = view.getUint32(entry_offset + 8, littleEndian);
		tags[tag] = get_tag_value(view, tiff_start, entry_offset, type, count, value_offset, littleEndian);
	}
}

function parse_exif_from_buffer(data) {
	const view = new DataView(data.buffer);
	if (view.getUint16(0) !== 0xFFD8) {
		throw new Error('Not a JPEG');
	}
	let offset = 2;
	while (offset < view.byteLength) {
		if (view.getUint8(offset) !== 0xFF) break;
		const marker = view.getUint8(offset + 1);
		const size = view.getUint16(offset + 2);
		if (marker === 0xE1) {
			const start = offset + 4;
			const header = String.fromCharCode(
				view.getUint8(start),
				view.getUint8(start + 1),
				view.getUint8(start + 2),
				view.getUint8(start + 3),
				view.getUint8(start + 4),
				view.getUint8(start + 5)
			);
			if (header === 'Exif\0\0') {
				const tiff_start = start + 6;
				const littleEndian = view.getUint16(tiff_start) === 0x4949;
				const first_ifd_offset = view.getUint32(tiff_start + 4, littleEndian);
				const tags = {};
				parse_ifd(view, tiff_start, first_ifd_offset, littleEndian, tags);
				const exif_sub_ifd_offset = tags[0x8769];
				if (typeof exif_sub_ifd_offset === 'number') {
					parse_ifd(view, tiff_start, exif_sub_ifd_offset, littleEndian, tags);
				}
				return tags;
			}
		}
		offset += 2 + size;
	}
	throw new Error('No EXIF data');
}

function data_url_to_uint8(src) {
	const base64 = src.split(',')[1];
	const binary = atob(base64);
	const len = binary.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

async function extract_exif_from_src(src) {
	try {
		let data;
		if (src.startsWith('data:')) {
			data = data_url_to_uint8(src);
		} else {
			const resp = await fetch(src);
			const buf = await resp.arrayBuffer();
			data = new Uint8Array(buf);
		}
		return parse_exif_from_buffer(data);
	} catch (_e) {
		return null;
	}
}
function update_preview_exif(src, token) {
	if (!preview_exif) return;
	extract_exif_from_src(src).then((tags) => {
		if (token !== preview_exif_token) return;
		const formatted = format_exif(tags);
		const text = formatted || 'Keine EXIF-Daten vorhanden.';
		preview_exif_cache.set(src, text);
		preview_exif.textContent = text;
	}).catch(() => {
		if (token !== preview_exif_token) return;
		const text = 'Keine EXIF-Daten vorhanden.';
		preview_exif_cache.set(src, text);
		preview_exif.textContent = text;
	});
}

function create_img_with_src(src) {
	let img = document.createElement('img');
	img.src = src;
	img.style.userSelect = 'none';
	img.classList.add('draggable');
	img.draggable = true;
	img.ondragstart = "event.dataTransfer.setData('text/plain', null)";
	img.addEventListener('mousedown', (evt) => {
		dragged_image = evt.target;
		dragged_image.classList.add("dragged");

	    // Grabs the index of the item's original placement prior to being dragged.
		old_item_index = get_item_index(dragged_image)
	});
	img.addEventListener('click', (evt) => {
		set_preview_image(evt.target.src);
	});
	return img;
}

function save(filename, text) {
	unsaved_changes = false;

	var el = document.createElement('a');
	el.setAttribute('href', 'data:text/html;charset=utf-8,' + encodeURIComponent(text));
	el.setAttribute('download', filename);
	el.style.display = 'none';
	document.body.appendChild(el);
	el.click();
	document.body.removeChild(el);
}

function save_tierlist(filename) {
	let serialized_tierlist = {
		title: document.querySelector('.title-label').innerText,
		rows: [],
	};
	tierlist_div.querySelectorAll('.row').forEach((row, i) => {
		// Converts and saves the header background color as hex for easy import later.
		let header = row.querySelector('.header');
		let r_value = header.style.backgroundColor.replace(/[^\d,]/g, '').split(',')[0];
		let g_value = header.style.backgroundColor.replace(/[^\d,]/g, '').split(',')[1];
		let b_value = header.style.backgroundColor.replace(/[^\d,]/g, '').split(',')[2];
		let color_hex = rgb_to_hex(r_value, g_value, b_value);

		serialized_tierlist.rows.push({
			name: row.querySelector('.header label').innerText.substr(0, MAX_NAME_LEN),
			color: color_hex
		});
		serialized_tierlist.rows[i].imgs = [];
		row.querySelectorAll('img').forEach((img) => {
			serialized_tierlist.rows[i].imgs.push(img.src);
		});
	});

	let untiered_imgs = document.querySelectorAll('.images img');
	if (untiered_imgs.length > 0) {
		serialized_tierlist.untiered = [];
		untiered_imgs.forEach((img) => {
			serialized_tierlist.untiered.push(img.src);
		});
	}

	save(filename, JSON.stringify(serialized_tierlist));
}

function load_tierlist(serialized_tierlist) {
	document.querySelector('.title-label').innerText = serialized_tierlist.title;
	for (let idx in serialized_tierlist.rows) {
		let ser_row = serialized_tierlist.rows[idx];
		let elem = add_row(idx, ser_row.name);

		for (let img_src of ser_row.imgs ?? []) {
			let img = create_img_with_src(img_src);
			let td = document.createElement('span');
			td.classList.add('item');
			td.appendChild(img);
			let items_container = elem.querySelector('.items');
			items_container.appendChild(td);
		}

		elem.querySelector('label').innerText = ser_row.name;
		// If "color" keys are found in the json, use them for the row header coloring.
		if (ser_row.color !== undefined) {
			let header = elem.querySelector('.header');
			header.style.backgroundColor = ser_row.color;
			header.querySelector('.row-color-picker').value = ser_row.color;
		} else {
			recompute_header_colors();
		}
	}

	if (serialized_tierlist.untiered) {
		let images = document.querySelector('.images');
		for (let img_src of serialized_tierlist.untiered) {
			let img = create_img_with_src(img_src);
			images.appendChild(img);
		}
	}

	resize_headers();

	unsaved_changes = false;
}

function rgb_to_hex(r, g, b) {
	return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
}

// Returns the supplied item's index within a row
function get_item_index(elem) {
	let rows = Array.from(tierlist_div.querySelectorAll(".row"));
	let parent_div = elem.parentNode.parentNode.parentNode;
	let idx = rows.indexOf(parent_div);
	if (rows[idx] !== undefined) {
		let image_node_list = rows[idx].querySelectorAll("img");
		for (let i = 0; i < image_node_list.length; i++) {
			if (image_node_list[i] == elem) {
				return i;
			}
		}
	}
	// Bottom images container
	// Note: images manipulated in the bottom container will have a different parent div after being moved
	// This accounts for both cases
	else if (parent_div.classList.contains("bottom-container") || parent_div.classList.contains("toggleable-container")) {
		let image_node_list = elem.parentNode.parentNode.parentNode.querySelectorAll("img");
		for (let i = 0; i < image_node_list.length; i++) {
			if (image_node_list[i] == elem) {
				// '-4' accounts for the four images in the buttons-container
				// required as part of the parent div changing for moved items
				return i - 4;
			}
		}
	}
	return null;
}

// Sets the item placement marker render location
function set_item_placement_marker_location(elem, is_hovering_row) {
	var h_offset = elem.offsetLeft.toString();
	let hovering_empty_bottom_container = false;

	// Hovering an empty bottom container
	// A normal row and the bottom-container have different marginLeft's
	// This ensures the marker appears correctly on an empty bottom-container
	if (elem.parentNode.classList.contains("bottom-container")) {
		hovering_empty_bottom_container = true;
	}

	// There is an 8px left margin offset before the tier begins (the blank gap)
	// This subtraction accounts for that
	h_offset -= 8;

	if (is_hovering_row && !hovering_empty_bottom_container){
		// Moves the vertical line to the right
		let position_info;
		let row_header = elem.getElementsByClassName("header");
		row_header = row_header[0];
		if (row_header !== undefined) {
			// Hovering the row-droppable div
			position_info = row_header.getBoundingClientRect();
		} else {
			// Hovering the row header or header label
			position_info = elem.getBoundingClientRect();
		}

		h_offset = position_info.right - 8;
		placement_marker_div.style.marginLeft = h_offset + "px";
	} else {
		placement_marker_div.style.marginLeft = h_offset + "px";
	}

	placement_marker_div.style.top = `${elem.offsetTop}px`;
}

function pre_calc_row_item_placement_marker_location(image_node_list, drag_enter_img) {
	let last_image = image_node_list[image_node_list.length - 1];
	
	if (last_image !== undefined) {
		// Rows has items
		set_item_placement_marker_location(last_image, true);
	}
	else {
		// Row is empty
		set_item_placement_marker_location(drag_enter_img, true);
	}
}

function end_drag(evt) {
	// Remove the placement marker after valid and invalid drop
	if (placement_marker_div.parentNode === document.body) {
		document.body.removeChild(placement_marker_div);
	}
	dragged_image?.classList.remove("dragged");
	dragged_image = null;
}

window.addEventListener('mouseup', end_drag);
window.addEventListener('dragend', end_drag);

function make_accept_drop(elem) {
	elem.classList.add('droppable');

  	let target_item_index;
  	let drag_enter_img;

	// Used to add and remove the placement marker
	placement_marker_div = document.createElement('div');
	placement_marker_div.classList.add("vl");

	elem.addEventListener('dragenter', (evt) => {
		drag_enter_img = evt.target;
		drag_enter_img.classList.add('drag-entered');
		// Grabs the index of the item that the dragged item is hovering.
		// Used for placing items within the row
		target_item_index = get_item_index(drag_enter_img);

		// Hovering a row
		if (drag_enter_img.classList.contains("row") || drag_enter_img.classList.contains("images")){
			let image_node_list = drag_enter_img.querySelectorAll("img");

			pre_calc_row_item_placement_marker_location(image_node_list, drag_enter_img);
		}
		// Hovering a row label or header
		else if (drag_enter_img.parentNode.classList.contains("row")){
			let image_node_list = drag_enter_img.parentNode.querySelectorAll("img");

			pre_calc_row_item_placement_marker_location(image_node_list, drag_enter_img);
		}
		// Hovering an item (image)
		else if (drag_enter_img.classList.contains("draggable")) {

			set_item_placement_marker_location(drag_enter_img, false);
		}

		document.body.appendChild(placement_marker_div);
	});

	elem.addEventListener('dragleave', (evt) => {
		evt.target.classList.remove('drag-entered');
	});

	elem.addEventListener('dragover', (evt) => {
		evt.preventDefault();
	});

	elem.addEventListener('drop', (evt) => {
		evt.preventDefault();
		evt.target.classList.remove('drag-entered');

		if (!dragged_image) {
			return;
		}

		let old_item_row;

		let dragged_image_parent = dragged_image.parentNode;
		if (dragged_image_parent.tagName.toUpperCase() === 'SPAN' &&
				dragged_image_parent.classList.contains('item')) {
			// We were already in a tier
			let containing_tr = dragged_image_parent.parentNode;

			// This is the same as setting the variable at the start of the grab
			old_item_row = containing_tr.parentNode;

			containing_tr.removeChild(dragged_image_parent);
		} else {
			dragged_image_parent.removeChild(dragged_image);
		}
		let td = document.createElement('span');
		td.classList.add('item');
		td.appendChild(dragged_image);
		let items_container = elem.querySelector('.items');
		if (!items_container) {
			// Quite lazy hack for <section class='images'>
			items_container = elem;
		}
		
		// Checks if the item is moving within the same row
		// Used as a fix along with target_item_index to ensure the item is placed to the left of the target
		// For example: Without this, on the same row, moving an item from index 2 -> 5 will place the item
		// to the right of the image (target item). This will ensure the image will always be to the left
		// of the target.
		if (items_container.parentNode === old_item_row && old_item_index < target_item_index){
			// Same row
			target_item_index = target_item_index - 1;
		}
	
		// Dragged onto the row
		// Appends the item instead of using the index
		if (evt.target.classList.contains("row")) {
			// This is a row
			items_container.appendChild(td);
		} else {
			items_container.insertBefore(td, items_container.children[target_item_index]);
		}

		clear_preview_for_dragged_image();
		unsaved_changes = true;
	});
}

function enable_edit_on_click(container, input, label, row_color_input) {
	function change_label(evt) {
		input.style.display = 'none';
		label.innerText = input.value;
		label.style.display = 'inline';

		// Prevents exception when this function is called for the title, and not a row
		if (row_color_input !== undefined) {
			container.style.backgroundColor = row_color_input.value;
			row_color_input.style.display = "none";
		}

		unsaved_changes = true;
	}

	// Close the header and apply header edits if the row is open.
	let evt_timestamp;
	container.addEventListener('focusout', (evt) => {
		if (evt.target.classList.value !== "row-color-picker" && evt.relatedTarget !== null) {
			if (evt.relatedTarget.classList.value === "row-color-picker") {
				// Do nothing
				label.innerText = input.value;
				evt_timestamp = evt.timeStamp;
			};
		// Grace period is 200 milliseconds
		// Required for Firefox as a focusout event exemption
		// When opening the color picker, an additional focusout event is called
		// This filters out the event so the header isn't closed
		} else if (evt.timeStamp <= evt_timestamp + 200) {
			// Do nothing
		} else {
			change_label();
		}
	});

	container.addEventListener('click', (evt) => {
		// Close the header and apply header edits if the header is open.
		// Only occurs when the header, is selected.
		if (evt.target.classList.value === "header" && input.style.display === 'inline') {
			change_label();
		} else {
			label.style.display = 'none';
			input.value = label.innerText.substr(0, MAX_NAME_LEN);
			input.style.display = 'inline';
			input.style.textAlign = "center";
			input.select();
		
			// Prevents exception when this function is called for the title, and not a row
			if (row_color_input !== undefined) {
				row_color_input.style.display = 'inline';
			}
		}
	});
}

function bind_title_events() {
	let title_label = document.querySelector('.title-label');
	let title_input = document.getElementById('title-input');
	let title = document.querySelector('.title');

	enable_edit_on_click(title, title_input, title_label);
}

function create_label_input(row, row_idx, row_name) {
	let input = document.createElement('input');
	input.id = `input-tier-${unique_id++}`;
	input.type = 'text';
	input.addEventListener('change', resize_headers);
	let label = document.createElement('label');
	label.htmlFor = input.id;
	label.innerText = row_name;

	let header = row.querySelector('.header');
	all_headers.splice(row_idx, 0, [header, input, label]);
	header.appendChild(label);
	header.appendChild(input);

	let row_color_input = document.createElement('input');
	row_color_input.type = "color";
	row_color_input.classList.add('row-color-picker');
	row_color_input.value = TIER_COLORS[row_idx % TIER_COLORS.length];
	row_color_input.style.padding = "0px";
	row_color_input.style.width = "100px";
	row_color_input.style.height = "100px";
	row_color_input.style.display = "none";
	header.appendChild(row_color_input);

	enable_edit_on_click(header, input, label, row_color_input);
}

function resize_headers() {
	let max_width = headers_orig_min_width;
	for (let [other_header, _i, label] of all_headers) {
		max_width = Math.max(max_width, label.clientWidth);
	}

	for (let [other_header, _i2, _l2] of all_headers) {
		other_header.style.minWidth = `${max_width}px`;
	}
}

function add_row(index, name) {
	let div = document.createElement('div');
	let header = document.createElement('span');
	let items = document.createElement('span');
	div.classList.add('row');
	header.classList.add('header');
	items.classList.add('items');
	div.appendChild(header);
	div.appendChild(items);
	let row_buttons = document.createElement('div');
	row_buttons.classList.add('row-buttons');
	let btn_plus_up = document.createElement('input');
	btn_plus_up.type = "button";
	btn_plus_up.value = '+';
	btn_plus_up.title = "Add row above";
	btn_plus_up.addEventListener('click', (evt) => {
		let parent_div = evt.target.parentNode.parentNode;
		let rows = Array.from(tierlist_div.children);
		let idx = rows.indexOf(parent_div);
		console.assert(idx >= 0);
		add_row(idx, '');
		recompute_header_colors(idx);
	});
	let btn_rm = document.createElement('input');
	btn_rm.type = "button";
	btn_rm.value = '-';
	btn_rm.title = "Remove row";
	btn_rm.addEventListener('click', (evt) => {
		let rows = Array.from(tierlist_div.querySelectorAll('.row'));
		if (rows.length < 2) return;
		let parent_div = evt.target.parentNode.parentNode;
		let idx = rows.indexOf(parent_div);
		console.assert(idx >= 0);
		if (rows[idx].querySelectorAll('img').length === 0 ||
			confirm(`Remove tier ${rows[idx].querySelector('.header label').innerText}? (This will move back all its content to the untiered pool)`))
		{
			rm_row(idx);
		}
	});
	let btn_plus_down = document.createElement('input');
	btn_plus_down.type = "button";
	btn_plus_down.value = '+';
	btn_plus_down.title = "Add row below";
	btn_plus_down.addEventListener('click', (evt) => {
		let parent_div = evt.target.parentNode.parentNode;
		let rows = Array.from(tierlist_div.children);
		let idx = rows.indexOf(parent_div);
		console.assert(idx >= 0);
		add_row(idx + 1, name);
		recompute_header_colors(idx + 1);
	});
	row_buttons.appendChild(btn_plus_up);
	row_buttons.appendChild(btn_rm);
	row_buttons.appendChild(btn_plus_down);
	div.appendChild(row_buttons);

	let rows = tierlist_div.children;
	if (index === rows.length) {
		tierlist_div.appendChild(div);
	} else {
		let nxt_child = rows[index];
		tierlist_div.insertBefore(div, nxt_child);
	}

	make_accept_drop(div);
	create_label_input(div, index, name);

	return div;
}

function rm_row(idx) {
	let row = tierlist_div.children[idx];
	reset_row(row);
	tierlist_div.removeChild(row);
}

function recompute_header_colors(idx) {
	// Computes the colors for the supplied row index, or if undefined, all the row headers.
	if (idx === undefined) {
		tierlist_div.querySelectorAll('.row').forEach((row, row_idx) => {
			let color = TIER_COLORS[row_idx % TIER_COLORS.length];
			let header = row.querySelector('.header');
			header.style.backgroundColor = color;
			header.querySelector('.row-color-picker').value = color;
		});
	} else {
		let rows = Array.from(tierlist_div.querySelectorAll(".row"));
		let color = TIER_COLORS[idx % TIER_COLORS.length];
		let header = rows[idx].querySelector('.header');
		header.style.backgroundColor = color;
		header.querySelector('.row-color-picker').value = color;
	}
}

function bind_trash_events() {
	let trash = document.getElementById('trash');
	trash.classList.add('droppable');
	trash.addEventListener('dragenter', (evt) => {
		evt.preventDefault();
		evt.target.src = 'trash_bin_open.png';
	});
	trash.addEventListener('dragexit', (evt) => {
		evt.preventDefault();
		evt.target.src = 'trash_bin.png';
	});
	trash.addEventListener('dragover', (evt) => {
		evt.preventDefault();
	});
	trash.addEventListener('drop', (evt) => {
		evt.preventDefault();
		evt.target.src = 'trash_bin.png';
		if (dragged_image) {
			let dragged_image_parent = dragged_image.parentNode;
			if (dragged_image_parent.tagName.toUpperCase() === 'SPAN' &&
					dragged_image_parent.classList.contains('item'))
			{
				// We were already in a tier
				let containing_tr = dragged_image_parent.parentNode;
					containing_tr.removeChild(dragged_image_parent);
			}
			clear_preview_for_dragged_image();
			dragged_image.remove();
		}
	});
}

function bind_toggle_layout_events() {
	let toggle = document.getElementById('toggle-layout');
	toggle.addEventListener('click', () => {
		set_layout((cur_layout + 1) % 2);
	});
}

function set_layout(layout) {
	let main = document.getElementsByClassName("main-content")[0];
	if (layout === LAYOUT_VERTICAL) {
		main.classList.add("vertical");
	} else {
		main.classList.remove("vertical");
	}
	cur_layout = layout;
}

function is_url (str) {
	try {
		new URL(str);
		return true;
	} catch (e) {
		return false;
	}
}

// Fetches a tierlist JSON file from the 'url' query parameter and loads it
async function try_load_tierlist_json () {
	const load_from_url = new URLSearchParams(window.location.search).get('url');
	if (load_from_url !== null && is_url(load_from_url)) {
		try {
			let result = await fetch(load_from_url);
			result = await result.json();
			hard_reset_list();
			load_tierlist(result);
		} catch (e) { console.error(e); }
	}
}
