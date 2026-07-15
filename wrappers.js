/* ==== AUTO-GENERATED EVENT-HANDLER WRAPPERS (CSP-compliant, replaces inline on* attributes) ==== */
function __h1(event, ) { checkPin(this.value) }
function __h2(event, ) { toggleSidebar() }
function __h3(event, ) { checkForUpdate(true) }
function __h4(event, ) { toggleDetailSidebar() }
function __h5(event, ) { openSettings() }
function __h6(event, ) { switchView('lib') }
function __h7(event, ) { switchView('ana') }
function __h8(event, ) { openAddCategoryModal() }
function __h9(event, ) { switchView('trash') }
function __h10(event, ) { chooseFolder() }
function __h11(event, ) { restoreFolderAccess() }
function __h12(event, ) { chooseFolder() }
function __h13(event, ) { toggleSortDropdown(event) }
function __h14(event, ) { applySortMode('name-asc') }
function __h15(event, ) { applySortMode('name-desc') }
function __h16(event, ) { applySortMode('count-desc') }
function __h17(event, ) { applySortMode('count-asc') }
function __h18(event, ) { applySortMode('created-desc') }
function __h19(event, ) { applySortMode('created-asc') }
function __h20(event, ) { applySortMode('recent') }
function __h21(event, ) { if(!event.target.closest('.card')) { event.preventDefault(); showContextMenu(event, 'ctx-grid'); } }
function __h22(event, ) { openAddModal() }
function __h23(event, ) { openAddCategoryModal() }
function __h24(event, ) { chooseFolder() }
function __h25(event, ) { restoreFolderAccess() }
function __h26(event, ) { openNineGridModal(selectedId) }
function __h27(event, ) { copyAllLinks() }
function __h28(event, ) { addLinkFromInput() }
function __h29(event, ) { startEditNote() }
function __h30(event, ) { saveNote() }
function __h31(event, ) { openNineGridModal(selectedId) }
function __h32(event, ) { openNineGridModal(selectedId) }
function __h33(event, ) { uploadShots() }
function __h34(event, ) { openEditModal() }
function __h35(event, ) { deleteCurrentItem() }
function __h36(event, ) { toggleTrashSelectAll() }
function __h37(event, ) { restoreSelectedTrash() }
function __h38(event, ) { permanentDeleteSelectedTrash() }
function __h39(event, ) { if(event.target===this) closeNineGridModal(); }
function __h40(event, ) { closeNineGridModal() }
function __h41(event, ) { toggleNineSelectAll() }
function __h42(event, ) { exportNineGridSelected() }
function __h43(event, ) { toggleNineViewMode() }
function __h44(event, ) { updateSetting('nineCols', this.value); renderNineGrid(); }
function __h45(event, ) { updateSetting('nineRatio', this.value); renderNineGrid(); }
function __h46(event, ) { if(event.target===this) closeShotNoteModal(); }
function __h47(event, ) { closeShotNoteModal() }
function __h48(event, ) { closeShotNoteModal() }
function __h49(event, ) { saveShotNoteModal() }
function __h50(event, ) { closeLightbox() }
function __h51(event, ) { navGallery(-1,event) }
function __h52(event, ) { event.stopPropagation() }
function __h53(event, ) { navGallery(1,event) }
function __h54(event, ) { closeItemModal() }
function __h55(event, ) { toggleCategoryDropdown() }
function __h56(event, ) { document.getElementById('tag-text-input').focus() }
function __h57(event, ) { closeItemModal() }
function __h58(event, ) { saveItemModal() }
function __h59(event, ) { document.getElementById('cat-modal').classList.remove('show') }
function __h60(event, ) { if(event.key==='Enter')saveCatModal() }
function __h61(event, ) { document.getElementById('cat-modal').classList.remove('show') }
function __h62(event, ) { saveCatModal() }
function __h63(event, ) { closeSettings() }
function __h64(event, ) { updateSetting('theme', this.value); setTheme(this.value); }
function __h65(event, ) { updateSetting('thumbSize', this.value); applySettings(); }
function __h66(event, ) { updateSetting('nineCols', this.value) }
function __h67(event, ) { updateSetting('nineRatio', this.value) }
function __h68(event, ) { chooseFolder() }
function __h69(event, ) { closeSettings();openImport() }
function __h70(event, ) { closeSettings();openExport() }
function __h71(event, ) { closeSettings() }
function __h72(event, ) { document.getElementById('export-modal').classList.remove('show') }
function __h73(event, ) { exportJSON() }
function __h74(event, ) { exportWSJSON() }
function __h75(event, ) { exportCSV() }
function __h76(event, ) { document.getElementById('import-modal').classList.remove('show') }
function __h77(event, ) { triggerImportJSON() }
function __h78(event, ) { triggerImportWSJSON() }
function __h79(event, ) { handleImportJSON(event) }
function __h80(event, ) { handleImportWSJSON(event) }
function __h81(event, ) { ctxRename() }
function __h82(event, ) { ctxDelete() }
function __h83(event, ) { cardCtxEdit() }
function __h84(event, ) { openAddModal() }
function __h85(event, ) { openAddCategoryModal() }
function __h86(event, ) { deleteCurrentItem(true) }
function __h87(event, ) { handleCardImgCtx('save') }
function __h88(event, ) { handleCardImgCtx('copy') }
function __h89(event, ) { handleCardImgCtx('note') }
function __h90(event, ) { handleCardImgCtx('delete') }
function __h91(event, ) { openAddCategoryModal() }
function __h92(event, ) { openAddModal() }
function __h93(event, ) { handleNineCtx('save') }
function __h94(event, ) { handleNineCtx('copy') }
function __h95(event, ) { handleNineCtx('pin') }
function __h96(event, ) { handleNineCtx('note') }
function __h97(event, ) { handleNineCtx('delete') }
function __h98(event, ) { document.getElementById('update-modal').classList.remove('show') }
function __h99(event, ) { document.getElementById('update-modal').classList.remove('show') }
function __h100(event, ) { handleShotUpload(event) }
function __h101(event, __P0__) { filterByCategory(__P0__, this) }
function __h102(event, __P0__) { showContextMenu(event, 'ctx-cat', __P0__) }
function __h103(event, __P0__) { handleCardClick(__P0__, event) }
function __h104(event, __P0__) { openNineGridModal(__P0__) }
function __h105(event, __P0__) { showContextMenu(event, 'ctx-card', __P0__) }
function __h106(event, __P0__) { libCardDragStart(__P0__, event) }
function __h107(event, ) { libCardDragEnd(event) }
function __h108(event, ) { libCardDragOver(event) }
function __h109(event, __P0__) { libCardDrop(__P0__, event) }
function __h110(event, ) { this.style.display='none';this.nextElementSibling.style.display='flex'; }
function __h111(event, __P0__) { copySingleLink(__P0__) }
function __h112(event, __P0__) { window.open(__P0__) }
function __h113(event, __P0__) { removeLink(__P0__) }
function __h114(event, __P0__) { window.open(__P0__) }
function __h115(event, __P0__, __P1__) { openGallery(__P0__, __P1__) }
function __h116(event, __P0__) { event.stopPropagation();pinShot(__P0__) }
function __h117(event, __P0__) { event.stopPropagation();deleteShot(__P0__) }
function __h118(event, __P0__) { toggleTrashSelect(__P0__) }
function __h119(event, __P0__) { event.stopPropagation(); toggleTrashSelect(__P0__) }
function __h120(event, ) { closeNineGridModal(); uploadShots(); }
function __h121(event, __P0__) { handleNineItemClick(__P0__, event) }
function __h122(event, __P0__) { nineDragStart(__P0__, event) }
function __h123(event, ) { nineDragEnd(event) }
function __h124(event, ) { nineDragOver(event) }
function __h125(event, __P0__) { nineDrop(__P0__, event) }
function __h126(event, __P0__) { nineCtxCurrentIdx=__P0__; showContextMenu(event, 'ctx-nine'); }
function __h127(event, ) { event.stopPropagation(); }
function __h128(event, __P0__, __P1__) { event.stopPropagation(); openGallery(__P0__, __P1__) }
function __h129(event, __P0__, __P1__) { openGallery(__P0__, __P1__) }
function __h130(event, __P0__) { event.stopPropagation(); galleryIndex = __P0__; renderLightbox(); }
function __h131(event, __P0__) { formTags.splice(__P0__,1); renderFormTags() }
function __h132(event, __P0__) { selectCategoryOption(__P0__) }

window.__Handlers = {
  __h1: __h1,
  __h2: __h2,
  __h3: __h3,
  __h4: __h4,
  __h5: __h5,
  __h6: __h6,
  __h7: __h7,
  __h8: __h8,
  __h9: __h9,
  __h10: __h10,
  __h11: __h11,
  __h12: __h12,
  __h13: __h13,
  __h14: __h14,
  __h15: __h15,
  __h16: __h16,
  __h17: __h17,
  __h18: __h18,
  __h19: __h19,
  __h20: __h20,
  __h21: __h21,
  __h22: __h22,
  __h23: __h23,
  __h24: __h24,
  __h25: __h25,
  __h26: __h26,
  __h27: __h27,
  __h28: __h28,
  __h29: __h29,
  __h30: __h30,
  __h31: __h31,
  __h32: __h32,
  __h33: __h33,
  __h34: __h34,
  __h35: __h35,
  __h36: __h36,
  __h37: __h37,
  __h38: __h38,
  __h39: __h39,
  __h40: __h40,
  __h41: __h41,
  __h42: __h42,
  __h43: __h43,
  __h44: __h44,
  __h45: __h45,
  __h46: __h46,
  __h47: __h47,
  __h48: __h48,
  __h49: __h49,
  __h50: __h50,
  __h51: __h51,
  __h52: __h52,
  __h53: __h53,
  __h54: __h54,
  __h55: __h55,
  __h56: __h56,
  __h57: __h57,
  __h58: __h58,
  __h59: __h59,
  __h60: __h60,
  __h61: __h61,
  __h62: __h62,
  __h63: __h63,
  __h64: __h64,
  __h65: __h65,
  __h66: __h66,
  __h67: __h67,
  __h68: __h68,
  __h69: __h69,
  __h70: __h70,
  __h71: __h71,
  __h72: __h72,
  __h73: __h73,
  __h74: __h74,
  __h75: __h75,
  __h76: __h76,
  __h77: __h77,
  __h78: __h78,
  __h79: __h79,
  __h80: __h80,
  __h81: __h81,
  __h82: __h82,
  __h83: __h83,
  __h84: __h84,
  __h85: __h85,
  __h86: __h86,
  __h87: __h87,
  __h88: __h88,
  __h89: __h89,
  __h90: __h90,
  __h91: __h91,
  __h92: __h92,
  __h93: __h93,
  __h94: __h94,
  __h95: __h95,
  __h96: __h96,
  __h97: __h97,
  __h98: __h98,
  __h99: __h99,
  __h100: __h100,
  __h101: __h101,
  __h102: __h102,
  __h103: __h103,
  __h104: __h104,
  __h105: __h105,
  __h106: __h106,
  __h107: __h107,
  __h108: __h108,
  __h109: __h109,
  __h110: __h110,
  __h111: __h111,
  __h112: __h112,
  __h113: __h113,
  __h114: __h114,
  __h115: __h115,
  __h116: __h116,
  __h117: __h117,
  __h118: __h118,
  __h119: __h119,
  __h120: __h120,
  __h121: __h121,
  __h122: __h122,
  __h123: __h123,
  __h124: __h124,
  __h125: __h125,
  __h126: __h126,
  __h127: __h127,
  __h128: __h128,
  __h129: __h129,
  __h130: __h130,
  __h131: __h131,
  __h132: __h132,
};
