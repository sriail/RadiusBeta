import { SW } from "@utils/proxy.ts";
import { Settings } from "@utils/settings.ts";
import { StoreManager } from "@utils/storage";
import { BareClient } from "@mercuryworkshop/bare-mux";
import splash from "@assets/splash.json";

interface Tab {
    id: string;
    title: string;
    url: string;
    favicon: string;
    isActive: boolean;
}

interface Bookmark {
    id: string;
    title: string;
    url: string;
    favicon: string;
}

const DEFAULT_BOOKMARKS: Bookmark[] = [
    { id: "google", title: "Google", url: "https://www.google.com", favicon: "/searchEngines/Google.png" },
    { id: "discord", title: "Discord", url: "https://discord.com", favicon: "https://discord.com/favicon.ico" },
    { id: "youtube", title: "YouTube", url: "https://www.youtube.com", favicon: "https://www.youtube.com/favicon.ico" },
    { id: "github", title: "GitHub", url: "https://github.com", favicon: "https://github.com/favicon.ico" },
    { id: "twitter", title: "Twitter", url: "https://twitter.com", favicon: "https://twitter.com/favicon.ico" },
    { id: "reddit", title: "Reddit", url: "https://www.reddit.com", favicon: "https://www.reddit.com/favicon.ico" },
];

export class TabManager {
    private tabs: Tab[] = [];
    private iframeRefs: Map<string, HTMLIFrameElement> = new Map();
    private sw: SW | null = null;
    private settings: Settings | null = null;
    private storage: StoreManager<"radius||tabs">;
    private bookmarkStorage: StoreManager<"radius||bookmarks">;
    private bareClient: BareClient;
    private isFullscreen = false;

    constructor() {
        this.storage = new StoreManager<"radius||tabs">("radius||tabs");
        this.bookmarkStorage = new StoreManager<"radius||bookmarks">("radius||bookmarks");
        this.bareClient = new BareClient();
    }

    async init() {
        this.sw = SW.getInstance().next().value!;
        this.settings = await Settings.getInstance();
        
        this.initBookmarks();
        await this.loadTabs();
        this.setupEventListeners();
        this.handleRedirectParam();
        this.setupKeyboardShortcuts();
        
        // NEW: Update tab sizes on window resize
        window.addEventListener('resize', () => this.updateTabSizes());
    }

    private initBookmarks() {
        const saved = this.bookmarkStorage.getVal("list");
        if (!saved) {
            this.bookmarkStorage.setVal("list", JSON.stringify(DEFAULT_BOOKMARKS));
        }
    }

    private getBookmarks(): Bookmark[] {
        const saved = this.bookmarkStorage.getVal("list");
        return saved ? JSON.parse(saved) : DEFAULT_BOOKMARKS;
    }

    private saveBookmarks(bookmarks: Bookmark[]) {
        this.bookmarkStorage.setVal("list", JSON.stringify(bookmarks));
    }

    private async loadTabs() {
        const savedTabs = this.storage.getVal("list");
        
        if (savedTabs) {
            try {
                this.tabs = JSON.parse(savedTabs);
                this.tabs.forEach(tab => this.renderTab(tab));
                
                const activeTab = this.tabs.find(t => t.isActive);
                if (activeTab) {
                    this.activateTab(activeTab.id);
                }
            } catch (e) {
                console.error("Failed to load saved tabs:", e);
                this.createDefaultTab();
            }
        } else {
            this.createDefaultTab();
        }
    }

    private createDefaultTab() {
        const newTab: Tab = {
            id: `tab-${Date.now()}`,
            title: "New Tab",
            url: "",
            favicon: "",
            isActive: true
        };
        this.tabs.push(newTab);
        this.renderTab(newTab);
        this.saveTabs();
    }

    private saveTabs() {
        this.storage.setVal("list", JSON.stringify(this.tabs));
    }

    private renderTab(tab: Tab) {
        const tabsContainer = document.getElementById("tabs-container");
        if (!tabsContainer) return;

        const tabElement = document.createElement("div");
        tabElement.id = `tab-${tab.id}`;
        tabElement.className = `flex-shrink-0 flex items-center justify-between h-9 px-3 relative rounded-t-lg mr-1 text-sm transition-all cursor-pointer group ${
            tab.isActive ? 'bg-(--card) shadow-sm z-10' : 'bg-(--muted) mt-1 hover:bg-(--accent)'
        }`;

        tabElement.style.minWidth = "40px";  // Just favicon + close button
        tabElement.style.maxWidth = "240px"; // Full width tab
        tabElement.style.flexShrink = "1";
        tabElement.style.flexGrow = "1";
        tabElement.draggable = true;

        const tabContent = document.createElement("div");
        tabContent.className = "flex items-center overflow-hidden mr-1";
        
        if (tab.favicon) {
            const favicon = document.createElement("img");
            favicon.src = tab.favicon;
            favicon.className = "w-4 h-4 mr-2 flex-shrink-0";
            favicon.onerror = () => favicon.style.display = "none";
            tabContent.appendChild(favicon);
        }

        const title = document.createElement("span");
        title.className = "truncate font-medium";
        title.textContent = tab.title;
        tabContent.appendChild(title);

        const closeBtn = document.createElement("button");
        closeBtn.className = "ml-1 p-0.5 rounded-full hover:bg-(--muted-foreground) opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity";
        closeBtn.innerHTML = '<span class="text-xs">✕</span>';
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            this.closeTab(tab.id);
        };

        tabElement.appendChild(tabContent);
        tabElement.appendChild(closeBtn);
        tabElement.onclick = () => this.activateTab(tab.id);

        tabElement.ondragstart = (e) => this.handleDragStart(e, tab.id);
        tabElement.ondragover = (e) => this.handleDragOver(e, tab.id);
        tabElement.ondragend = () => this.handleDragEnd();

        tabsContainer.appendChild(tabElement);

        this.renderTabContent(tab);
        
        // Update tab sizes
        setTimeout(() => this.updateTabSizes(), 50);
    }

 private renderTabContent(tab: Tab) {
    const contentArea = document.getElementById("tab-content-area");
    if (!contentArea) return;

    const tabContentDiv = document.createElement("div");
    tabContentDiv.id = `content-${tab.id}`;
    tabContentDiv.style.position = 'absolute';
    tabContentDiv.style.top = '0';
    tabContentDiv.style.left = '0';
    tabContentDiv.style.width = '100%';
    tabContentDiv.style.height = '100%';
    tabContentDiv.style.display = tab.isActive ? 'block' : 'none';
    tabContentDiv.style.zIndex = tab.isActive ? '10' : '1';

    if (tab.url === "about:settings") {
        // Render settings page directly
        tabContentDiv.innerHTML = this.getSettingsPageHTML();
        this.setupSettingsPageListeners(tab.id);
        
        // Update tab display with Google's settings cogwheel icon
        tab.title = "Settings";
        tab.favicon = "https://ssl.gstatic.com/images/branding/product/1x/gsa_settings_96dp.png";
        this.updateTabDisplay(tab.id);
    } else if (tab.url && !tab.url.startsWith("about:")) {
        const iframe = document.createElement("iframe");
        iframe.id = `iframe-${tab.id}`;
        iframe.className = "w-full h-full border-0";
        iframe.src = this.sw!.encodeURL(tab.url);
        iframe.sandbox.add("allow-same-origin", "allow-scripts", "allow-forms", "allow-popups", "allow-presentation", "allow-top-navigation-by-user-activation", "allow-pointer-lock");
        
        iframe.onload = () => this.handleIframeLoad(tab.id);
        
        this.iframeRefs.set(tab.id, iframe);
        tabContentDiv.appendChild(iframe);
    } else {
        tabContentDiv.innerHTML = this.getNewTabPageHTML();
        this.setupNewTabPageListeners(tab.id);
    }

    contentArea.appendChild(tabContentDiv);
}
    
        private updateTabSizes() {
        const tabsContainer = document.getElementById("tabs-container");
        if (!tabsContainer) return;

        const containerWidth = tabsContainer.offsetWidth - 40;
        const tabCount = this.tabs.length;
        
        const maxTabWidth = 240;
        const minTabWidth = 40;
        const compactThreshold = 100;
        const idealWidth = containerWidth / tabCount;
        
        let tabWidth: number;
        let isScrollable = false;
        
        if (idealWidth >= maxTabWidth) {
            tabWidth = maxTabWidth;
        } else if (idealWidth >= minTabWidth) {
            tabWidth = idealWidth;
        } else {
            tabWidth = minTabWidth;
            isScrollable = true;
        }
        
        // Apply width and styling to all tabs
        this.tabs.forEach(tab => {
            const tabEl = document.getElementById(`tab-${tab.id}`) as HTMLElement;
            if (tabEl) {
                tabEl.style.width = `${tabWidth}px`;
                tabEl.style.maxWidth = `${tabWidth}px`;
                tabEl.style.minWidth = `${tabWidth}px`;
                
                // Add/remove compact class
                if (tabWidth < compactThreshold) {
                    tabEl.classList.add('compact');
                } else {
                    tabEl.classList.remove('compact');
                }
                
                // Hide/show title text
                const titleSpan = tabEl.querySelector('span') as HTMLElement;
                if (titleSpan) {
                    if (tabWidth < 80) {
                        titleSpan.style.display = 'none';
                    } else {
                        titleSpan.style.display = 'block';
                    }
                }
                
                // Adjust favicon margin on small tabs
                const favicon = tabEl.querySelector('img') as HTMLElement;
                if (favicon) {
                    if (tabWidth < 80) {
                        favicon.style.marginRight = '0';
                    } else {
                        favicon.style.marginRight = '0.5rem';
                    }
                }
            }
        });
        
        // Adjust container scrolling
        if (isScrollable) {
            tabsContainer.style.justifyContent = 'flex-start';
        } else {
            tabsContainer.style.justifyContent = 'flex-start';
        }
    }

    private scrollToTab(tabId: string) {
        const tabsContainer = document.getElementById("tabs-container");
        const tabEl = document.getElementById(`tab-${tabId}`);
        
        if (tabsContainer && tabEl) {
            // Smooth scroll the active tab into view
            tabEl.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'center'
            });
        }
    }

    private getNewTabPageHTML(): string {
        const randomSplash = splash[Math.floor(Math.random() * splash.length)].splash;
        const bookmarks = this.getBookmarks();
        
        return `
            <div class="w-full h-full flex flex-col items-center justify-start pt-20 bg-(--background) overflow-auto">
                <div class="z-10 text-center max-w-4xl w-full px-6 flex flex-col items-center">
                    <div class="mb-10">
                        <div class="flex items-center justify-center gap-2 mb-2">
                            <svg class="h-16 w-16" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                            </svg>
                            <h1 class="text-6xl font-semibold">Radius</h1>
                        </div>
                        <p class="text-sm opacity-70">${randomSplash}</p>
                    </div>

                    <div class="w-full max-w-lg mb-10">
                        <div class="relative">
                            <div class="absolute left-4 top-1/2 transform -translate-y-1/2 opacity-50 pointer-events-none">
                                <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="11" cy="11" r="8"></circle>
                                    <path d="m21 21-4.35-4.35"></path>
                                </svg>
                            </div>
                            <input 
                                id="new-tab-search" 
                                type="text" 
                                placeholder="Search the web or enter address"
                                class="w-full rounded-full bg-(--card) hover:bg-(--accent) focus:bg-(--card) pl-12 pr-12 h-12 transition-all border border-(--border) focus:border-(--primary) focus:outline-none"
                            />
                        </div>
                    </div>

                    <div class="w-full">
                        <h3 class="text-lg font-medium mb-4 opacity-80 text-left px-2">Bookmarks</h3>
                        <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 px-2">
                            ${bookmarks.map(bm => `
                                <button data-bookmark-url="${bm.url}" class="bookmark-item flex flex-col items-center justify-center p-4 rounded-xl bg-(--card) hover:bg-(--accent) border border-(--border) transition-colors h-[120px]">
                                    <div class="w-10 h-10 rounded-full bg-(--background) flex items-center justify-center mb-2 overflow-hidden">
                                        <img src="${bm.favicon}" alt="" class="w-6 h-6" onerror="this.style.display='none'" />
                                    </div>
                                    <span class="text-sm font-medium truncate max-w-full">${bm.title}</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

 private getSettingsPageHTML(): string {
    return `
      <div class="h-screen w-full flex font-inter overflow-hidden">
            <div class="w-1/4 bg-(--background) flex mt-14 overflow-y-auto">
                <div class="h-full w-full flex flex-col font-inter p-4 pl-8 pt-8 gap-2 overflow-y-auto">
                    <a href="#" data-settings-page="proxy" class="settings-nav-link gap-2 px-4 py-2 rounded-lg h-10 w-full text-sm font-medium transition-colors items-center justify-start inline-flex bg-(--secondary) hover:bg-(--secondary)/[0.8]">
                        <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        Proxy
                    </a>
                    <a href="#" data-settings-page="appearance" class="settings-nav-link gap-2 px-4 py-2 rounded-lg h-10 w-full text-sm font-medium transition-colors items-center justify-start inline-flex bg-(--background) hover:bg-(--accent)">
                        <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
                        </svg>
                        Appearance
                    </a>
                    <a href="#" data-settings-page="credits" class="settings-nav-link gap-2 px-4 py-2 rounded-lg h-10 w-full text-sm font-medium transition-colors items-center justify-start inline-flex bg-(--background) hover:bg-(--accent)">
                        <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                        Credits
                    </a>
                    <a href="#" data-settings-page="cloaking" class="settings-nav-link gap-2 px-4 py-2 rounded-lg h-10 w-full text-sm font-medium transition-colors items-center justify-start inline-flex bg-(--background) hover:bg-(--accent)">
                        <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                        Cloaking
                    </a>
                </div>
            </div>
            <div class="h-screen mt-14 flex-grow px-12 py-8 flex flex-col overflow-y-auto">
                <div id="settings-content-area">
                    <h1 class="text-4xl font-semibold">Proxy</h1>
                    <div class="border-b border-(--border) w-full mb-4"></div>
                    <div class="w-full flex-grow">
                        <div>
                            <p>Proxy Switcher</p>
                            <select id="dropdownBox-pSwitcher" class="cursor-pointer flex h-10 w-[180px] items-center justify-between text-(--foreground) background-(--background) rounded-lg border border-(--border) px-3 py-2 text-sm">
                                <option class="w-full bg-(--accent) rounded-sm p-1" value="uv">Ultraviolet</option>
                                <option class="w-full bg-(--accent) rounded-sm p-1" value="sj">Scramjet</option>
                            </select>
                        </div>
                        <div class="mt-2">
                            <p>Transport</p>
                            <select id="dropdownBox-tSwitcher" class="cursor-pointer flex h-10 w-[180px] items-center justify-between text-(--foreground) background-(--background) rounded-lg border border-(--border) px-3 py-2 text-sm">
                                <option class="w-full bg-(--accent) rounded-sm p-1" value="libcurl">Libcurl</option>
                                <option class="w-full bg-(--accent) rounded-sm p-1" value="epoxy">Epoxy</option>
                            </select>
                        </div>
                        <div class="mt-2">
                            <p>Search Engine</p>
                            <select id="dropdownBox-sSwitcher" class="cursor-pointer flex h-10 w-[180px] items-center justify-between text-(--foreground) background-(--background) rounded-lg border border-(--border) px-3 py-2 text-sm">
                                <option class="w-full bg-(--accent) rounded-sm p-1" value="https://www.google.com/search?q=">Google</option>
                                <option class="w-full bg-(--accent) rounded-sm p-1" value="https://duckduckgo.com/?q=">DuckDuckGo</option>
                                <option class="w-full bg-(--accent) rounded-sm p-1" value="https://www.bing.com/search?q=">Bing</option>
                                <option class="w-full bg-(--accent) rounded-sm p-1" value="https://search.brave.com/search?q=">Brave</option>
                            </select>
                        </div>
                        
                        <div class="mt-6 pt-6 border-t border-(--border)">
                            <h2 class="text-2xl font-semibold mb-4">Tab Settings</h2>
                            <div class="mt-2">
                                <p>Allow Tab Reordering <span class="text-xs opacity-60">(Experimental)</span></p>
                                <select id="dropdownBox-tabReorder" class="cursor-pointer flex h-10 w-[180px] items-center justify-between text-(--foreground) background-(--background) rounded-lg border border-(--border) px-3 py-2 text-sm">
                                    <option class="w-full bg-(--accent) rounded-sm p-1" value="true">Enabled</option>
                                    <option class="w-full bg-(--accent) rounded-sm p-1" value="false">Disabled</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="mt-2 w-80">
                            <div>
                                <p>Wisp Server</p>
                                <input class="h-10 w-full rounded-md border border-(--border) px-3 py-2 text-sm" placeholder="Wisp server URL (EX: wss://radiusproxy.app/wisp/" id="wispServerSwitcher" />
                                <div class="mt-2 hidden" id="adBlocking">
                                    <p>Ad Blocking</p>
                                    <select id="dropdownBox-adBlocking" class="cursor-pointer flex h-10 w-[180px] items-center justify-between text-(--foreground) background-(--background) rounded-lg border border-(--border) px-3 py-2 text-sm">
                                        <option class="w-full bg-(--accent) rounded-sm p-1" value="enabled">Enabled</option>
                                        <option class="w-full bg-(--accent) rounded-sm p-1" value="disabled">Disabled</option>
                                    </select>
                                </div>
                            </div>
                            <div class="mt-2 mb-2 hidden" id="wispServerInfo">
                                <p class="text-blue-500" id="wispServerInfo-inner">Checking URL...</p>
                            </div>
                            <div class="mt-2 flex flex-row gap-4">
                                <button id="wispServerSave" class="bg-(--primary) hover:bg-(--primary)/90 cursor-pointer text-(--primary-foreground) inline-flex items-center jusitfy-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors h-10 px-4 py-2">
                                    <svg class="text-(--primary-foreground) h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                                        <polyline points="17 21 17 13 7 13 7 21"></polyline>
                                        <polyline points="7 3 7 8 15 8"></polyline>
                                    </svg>
                                    Save Changes
                                </button>
                                <button id="wispServerReset" class="bg-(--primary) hover:bg-(--primary)/90 cursor-pointer text-(--primary-foreground) inline-flex items-center jusitfy-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors h-10 px-4 py-2">
                                    <svg class="text-(--primary-foreground) h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="23 4 23 10 17 10"></polyline>
                                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                                    </svg>
                                    Reset
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

    private setupNewTabPageListeners(tabId: string) {
        setTimeout(() => {
            const searchInput = document.getElementById("new-tab-search") as HTMLInputElement;
            if (searchInput) {
                searchInput.addEventListener("keypress", (e) => {
                    if (e.key === "Enter") {
                        this.navigateTab(tabId, searchInput.value);
                    }
                });
                searchInput.focus();
            }

            const bookmarkItems = document.querySelectorAll(".bookmark-item");
            bookmarkItems.forEach(item => {
                item.addEventListener("click", () => {
                    const url = (item as HTMLElement).dataset.bookmarkUrl;
                    if (url) this.navigateTab(tabId, url);
                });
            });
        }, 100);
    }

private setupSettingsPageListeners(tabId: string) {
    setTimeout(() => {
        const proxyEl = document.getElementById("dropdownBox-pSwitcher") as HTMLSelectElement;
        const transportEl = document.getElementById("dropdownBox-tSwitcher") as HTMLSelectElement;
        const seEl = document.getElementById("dropdownBox-sSwitcher") as HTMLSelectElement;
        const tabReorderEl = document.getElementById("dropdownBox-tabReorder") as HTMLSelectElement;
        const wispServerSwitcher = document.getElementById("wispServerSwitcher") as HTMLInputElement;
        const wispServerInfo = document.getElementById("wispServerInfo") as HTMLElement;
        const wispServerInfoInner = document.getElementById("wispServerInfo-inner") as HTMLParagraphElement;
        const wispServerSave = document.getElementById("wispServerSave") as HTMLButtonElement;
        const wispServerReset = document.getElementById("wispServerReset") as HTMLButtonElement;
        const adBlocking = document.getElementById("adBlocking") as HTMLDivElement;

        // Proxy switcher
        if (proxyEl) {
            proxyEl.value = this.storage.getVal("proxy") || "uv";
            proxyEl.addEventListener("change", () => {
                if (this.settings) {
                    this.settings.proxy(proxyEl.value as "uv" | "sj");
                }
            });
        }

        // Transport switcher
        if (transportEl) {
            transportEl.value = this.storage.getVal("transport") || "libcurl";
            transportEl.addEventListener("change", async () => {
                if (this.sw) {
                    await this.sw.setTransport(transportEl.value as "epoxy" | "libcurl");
                }
            });
        }

        // Search engine
        if (seEl) {
            seEl.value = this.storage.getVal("searchEngine") || "https://duckduckgo.com/?q=";
            seEl.addEventListener("change", () => {
                if (this.settings) {
                    this.settings.searchEngine(seEl.value);
                }
            });
        }

        // Tab reordering
        if (tabReorderEl) {
            tabReorderEl.value = this.storage.getVal("allowTabReordering") || "false";
            tabReorderEl.addEventListener("change", () => {
                this.storage.setVal("allowTabReordering", tabReorderEl.value);
            });
        }

        // Wisp server
        if (wispServerSwitcher) {
            wispServerSwitcher.value = this.storage.getVal("wispServer");
        }

        const resetVal = `${(location.protocol === "https:" ? "wss://" : "ws://")}${location.host}/wisp/`;
        
        const reset = (hide: boolean = true) => {
            if (hide && wispServerInfo) wispServerInfo.classList.add("hidden");
            if (wispServerInfoInner) {
                wispServerInfoInner.innerText = "Checking URL...";
                wispServerInfoInner.classList.remove("text-red-500");
                wispServerInfoInner.classList.remove("text-green-500");
            }
        };

        const adBlockingFunc = () => {
            const adBlockingDropdown = document.getElementById("dropdownBox-adBlocking") as HTMLSelectElement;
            if (adBlockingDropdown) {
                adBlockingDropdown.addEventListener("change", () => {
                    if (this.settings) {
                        this.settings.adBlock(adBlockingDropdown.value === "enabled" ? true : false);
                    }
                });

                adBlockingDropdown.value = this.storage.getVal("adBlock") === "true" ? "enabled" : "disabled";

                if (wispServerSwitcher && wispServerSwitcher.value === resetVal) {
                    adBlocking?.classList.remove("hidden");
                    if (this.settings) {
                        this.settings.adBlock(true);
                    }
                    adBlockingDropdown.value = "enabled";
                } else {
                    adBlocking?.classList.add("hidden");
                    if (this.settings) {
                        this.settings.adBlock(false);
                    }
                }
            }
        };
        adBlockingFunc();

        if (wispServerSave) {
            wispServerSave.addEventListener("click", async () => {
                const server = wispServerSwitcher.value;
                wispServerInfo?.classList.remove("hidden");

                if (!server.match(/^wss?:\/\/.*/)) {
                    reset(false);
                    if (wispServerInfoInner) {
                        wispServerInfoInner.innerText = "Invalid URL! \nURL's MUST start with wss:// or ws://";
                        wispServerInfoInner.classList.add("text-red-500");
                    }
                } else {
                    reset(false);
                    if (wispServerInfoInner) {
                        wispServerInfoInner.innerText = "Wisp Server Set!";
                        wispServerInfoInner.classList.add("text-green-500");
                    }
                    if (this.sw) {
                        await this.sw.wispServer(wispServerSwitcher.value, true);
                    }
                    adBlockingFunc();
                }

                setTimeout(reset, 4000);
            });
        }

        if (wispServerReset) {
            wispServerReset.addEventListener("click", async () => {
                wispServerInfo?.classList.remove("hidden");
                if (wispServerInfoInner) {
                    wispServerInfoInner.innerText = "Wisp Server Reset!";
                    wispServerInfoInner.classList.add("text-green-500");
                }
                if (this.sw) {
                    await this.sw.wispServer(resetVal, true);
                }
                if (wispServerSwitcher) {
                    wispServerSwitcher.value = this.storage.getVal("wispServer");
                }
                setTimeout(reset, 4000);
                adBlockingFunc();
            });
        }

        // Navigation between settings pages
        const navLinks = document.querySelectorAll(".settings-nav-link");
        navLinks.forEach(link => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                const page = (link as HTMLElement).dataset.settingsPage;
                
                // Update active state
                navLinks.forEach(l => {
                    l.className = "settings-nav-link gap-2 px-4 py-2 rounded-lg h-10 w-full text-sm font-medium transition-colors items-center justify-start inline-flex bg-(--background) hover:bg-(--accent)";
                });
                link.className = "settings-nav-link gap-2 px-4 py-2 rounded-lg h-10 w-full text-sm font-medium transition-colors items-center justify-start inline-flex bg-(--secondary) hover:bg-(--secondary)/[0.8]";
                
                // Update content based on selected page
                const contentArea = document.getElementById("settings-content-area");
                if (contentArea && page === "appearance") {
                    contentArea.innerHTML = `
                        <h1 class="text-4xl font-semibold">Appearance</h1>
                        <div class="border-b border-(--border) w-full mb-4"></div>
                        <div class="w-full flex-grow">
                            <div>
                                <p>Themes</p>
                                <select id="dropdownBox-themeSwitcher" class="cursor-pointer flex h-10 w-[180px] items-center justify-between text-(--foreground) background-(--background) rounded-lg border border-(--border) px-3 py-2 text-sm">
                                <option class="w-full bg-(--accent) rounded-sm p-1" value="default">Default</option>
                                <option class="w-full bg-(--accent) rounded-sm p-1" value="amoled">Amoled</option>
                                <option class="w-full bg-(--accent) rounded-sm p-1" value="catppuccin">Catppuccin</option>
                                <option class="w-full bg-(--accent) rounded-sm p-1" value="nord">Nord</option>
                                <option class="w-full bg-(--accent) rounded-sm p-1" value="rose-pine">Rose Pine</option>
                                 </select>
                            </div>
                        </div>
                    `;
                    
                    const themeDropdown = document.getElementById("dropdownBox-themeSwitcher") as HTMLSelectElement;
                    if (themeDropdown && this.settings) {
                        themeDropdown.value = this.storage.getVal('theme') || 'default';
                        themeDropdown.addEventListener("change", () => {
                            if (this.settings) {
                                this.settings.theme(themeDropdown.value);
                            }
                        });
                    }
                } else if (contentArea && page === "credits") {
                    contentArea.innerHTML = `
                        <h1 class="text-4xl font-semibold">Credits</h1>
                        <div class="border-b border-(--border) w-full mb-4"></div>
                        <div class="w-full flex-grow">
                            <div>
                                <p>Thanks to all the wonderful people who have contributed!</p>
                                <ul class="list-disc pl-5 mt-2 font-bold">
                                    <li><a class="underline hover:text-(--accent) transition-colors duration-300" href="https://github.com/hyperficial" target="_blank" rel="noopener noreferrer">Owski</a></li>
                                    <li><a href="https://github.com/proudparrot2" target="_blank" rel="noopener noreferrer" class="underline hover:text-(--accent) transition-colors duration-300">ProudParrot</a></li>
                                    <li><a class="underline hover:text-(--accent) transition-colors duration-300" href="https://github.com/motortruck1221" target="_blank" rel="noopener noreferrer">MotorTruck1221</a></li>
                                    <li><a href="https://mercurywork.shop" target="_blank" rel="noopener noreferrer" class="underline hover:text-(--accent) transition-colors duration-300">The wonderful people over at MercuryWorkshop</a></li>
                                    <li><a href="https://github.com/titaniumnetwork-dev" target="_blank" rel="noopener noreferrer" class="underline hover:text-(--accent) transition-colors duration-300">Everyone over at TitaniumNetwork</a></li>
                                    <li><a href="https://github.com/RadiusProxy/Radius/graphs/contributors" target="_blank" rel="noopener noreferrer" class="underline hover:text-(--accent) transition-colors duration-300">And Everyone else who has contributed!</a></li>
                                </ul>
                            </div>
                            <div class="border-t-2 border-(--border) mt-2">
                                <p class="mt-2">Projects that we use:</p>
                                <ul class="list-disc pl-5 mt-2 font-bold">
                                    <li><a href="https://github.com/titaniumnetwork-dev/ultraviolet" target="_blank" rel="noopener noreferrer" class="underline transition-colors duration-300 hover:text-(--accent)">Ultraviolet</a></li>
                                    <li><a href="https://github.com/mercuryworkshop/scramjet" target="_blank" rel="noopener noreferrer" class="underline transition-colors duration-300 hover:text-(--accent)">Scramjet</a></li>
                                    <li><a href="https://github.com/ading2210/libcurl.js" target="_blank" rel="noopener noreferrer" class="underline transition-colors duration-300 hover:text-(--accent)">Libcurl.js</a></li>
                                    <li><a href="https://github.com/mercuryworkshop/epoxy-tls" target="_blank" rel="noopener noreferrer" class="underline transition-colors duration-300 hover:text-(--accent)">Epoxy TLS</a></li>
                                </ul>
                            </div>
                        </div>
                    `;
                } else if (contentArea && page === "cloaking") {
                    contentArea.innerHTML = `
                        <h1 class="text-4xl font-semibold">Cloaking</h1>
                        <div class="border-b border-(--border) w-full mb-4"></div>
                        <div class="w-full flex-grow">
                            <div class="w-full flex flex-row gap-4">
                                <div class="w-1/2">
                                    <div>
                                        <p>About Blank</p>
                                        <input class="h-10 w-full rounded-md border border-(--border) px-3 py-2 text-sm" placeholder="Redirect url (EX: https://google.com)" id="aboutBlankCloaker" />
                                    </div>
                                    <div class="mt-2">
                                        <button id="aboutBlankLaunch" class="bg-(--primary) hover:bg-(--primary)/90 cursor-pointer text-(--primary-foreground) inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors h-10 px-4 py-2">
                                            Cloak!
                                        </button>
                                    </div>
                                </div>
                                <div class="w-1/2">
                                    <div>
                                        <p>Blob</p>
                                        <input class="h-10 w-full rounded-md border border-(--border) px-3 py-2 text-sm" placeholder="Redirect url (EX: https://google.com)" id="blobCloaker" />
                                    </div>
                                    <div class="mt-2">
                                        <button id="blobLaunch" class="bg-(--primary) hover:bg-(--primary)/90 cursor-pointer text-(--primary-foreground) inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors h-10 px-4 py-2">
                                            Cloak!
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                    
                    // Setup cloaking button listeners
                    const aboutBlankInput = document.getElementById("aboutBlankCloaker") as HTMLInputElement;
                    const aboutBlankButton = document.getElementById("aboutBlankLaunch") as HTMLButtonElement;
                    const blobInput = document.getElementById("blobCloaker") as HTMLInputElement;
                    const blobButton = document.getElementById("blobLaunch") as HTMLButtonElement;
                    
                    if (aboutBlankButton && aboutBlankInput && this.settings && this.sw) {
                        aboutBlankButton.addEventListener("click", () => {
                            const url = this.sw!.search(aboutBlankInput.value, this.storage.getVal('searchEngine'));
                            this.settings!.cloak(url).aboutBlank();
                        });
                    }
                    
                    if (blobButton && blobInput && this.settings && this.sw) {
                        blobButton.addEventListener("click", () => {
                            const url = this.sw!.search(blobInput.value, this.storage.getVal('searchEngine'));
                            this.settings!.cloak(url).blob();
                        });
                    }
                }
            });
        });
    }, 100);
}
    
    private handleIframeLoad(tabId: string) {
        const tab = this.tabs.find(t => t.id === tabId);
        const iframe = this.iframeRefs.get(tabId);
        
        if (!tab || !iframe) return;

        try {
            const iframeDoc = iframe.contentWindow?.document;
            if (iframeDoc) {
                const title = iframeDoc.title || tab.url;
                const faviconLink = iframeDoc.querySelector("link[rel='icon'], link[rel='shortcut icon']") as HTMLLinkElement;
                
                tab.title = title;
                if (faviconLink) {
                    tab.favicon = faviconLink.href;
                }
                
                this.updateTabDisplay(tabId);
                this.saveTabs();
            }
        } catch (e) {
            this.fetchFavicon(tabId, tab.url);
        }
    }

    private async fetchFavicon(tabId: string, url: string) {
        try {
            const data = await this.bareClient.fetch(`https://www.google.com/s2/favicons?domain=${url}&sz=64`);
            const blob = await data.blob();
            const objectURL = URL.createObjectURL(blob);
            
            const tab = this.tabs.find(t => t.id === tabId);
            if (tab) {
                tab.favicon = objectURL;
                this.updateTabDisplay(tabId);
                this.saveTabs();
            }
        } catch (e) {
            console.error("Failed to fetch favicon:", e);
        }
    }

    private updateTabDisplay(tabId: string) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;

        const tabElement = document.getElementById(`tab-${tabId}`);
        if (tabElement) {
            const titleSpan = tabElement.querySelector("span");
            if (titleSpan) titleSpan.textContent = tab.title;

            const favicon = tabElement.querySelector("img");
            if (tab.favicon && !favicon) {
                const newFavicon = document.createElement("img");
                newFavicon.src = tab.favicon;
                newFavicon.className = "w-4 h-4 mr-2 flex-shrink-0";
                const content = tabElement.querySelector("div");
                content?.prepend(newFavicon);
            } else if (favicon && tab.favicon) {
                favicon.src = tab.favicon;
            }
        }
    }

    private activateTab(tabId: string) {
        this.tabs.forEach(tab => {
            tab.isActive = tab.id === tabId;
            
            const tabEl = document.getElementById(`tab-${tab.id}`);
            if (tabEl) {
                if (tab.isActive) {
                    tabEl.className = tabEl.className.replace('bg-(--muted) mt-1 hover:bg-(--accent)', 'bg-(--card) shadow-sm z-10');
                } else {
                    tabEl.className = tabEl.className.replace('bg-(--card) shadow-sm z-10', 'bg-(--muted) mt-1 hover:bg-(--accent)');
                }
            }

            const contentEl = document.getElementById(`content-${tab.id}`) as HTMLElement;
            if (contentEl) {
                if (tab.isActive) {
                    contentEl.style.display = 'block';
                    contentEl.style.zIndex = '10';
                } else {
                    contentEl.style.display = 'none';
                    contentEl.style.zIndex = '1';
                }
            }
        });

     const activeTab = this.tabs.find(t => t.id === tabId);
    if (activeTab) {
        const urlInput = document.getElementById("url-input") as HTMLInputElement;
        if (urlInput) urlInput.value = activeTab.url;
        
        // NEW: Scroll to active tab
        this.scrollToTab(tabId);
    }

    this.saveTabs();
}

    private closeTab(tabId: string) {
        if (this.tabs.length === 1) {
            const tab = this.tabs[0];
            tab.url = "";
            tab.title = "New Tab";
            tab.favicon = "";
            
            const contentEl = document.getElementById(`content-${tab.id}`);
            if (contentEl) {
                contentEl.innerHTML = this.getNewTabPageHTML();
                this.setupNewTabPageListeners(tab.id);
            }
            
            this.updateTabDisplay(tab.id);
            this.saveTabs();
            return;
        }

        const tabIndex = this.tabs.findIndex(t => t.id === tabId);
        const wasActive = this.tabs[tabIndex].isActive;

        document.getElementById(`tab-${tabId}`)?.remove();
        document.getElementById(`content-${tabId}`)?.remove();
        this.iframeRefs.delete(tabId);

        this.tabs.splice(tabIndex, 1);

        if (wasActive && this.tabs.length > 0) {
            const newActiveIndex = Math.max(0, tabIndex - 1);
            this.activateTab(this.tabs[newActiveIndex].id);
        }

        this.saveTabs();
        
        // NEW: Update tab sizes
        setTimeout(() => this.updateTabSizes(), 50);
    }

    private addTab() {
        const newTab: Tab = {
            id: `tab-${Date.now()}`,
            title: "New Tab",
            url: "",
            favicon: "",
            isActive: true
        };

        this.tabs.forEach(t => t.isActive = false);
        this.tabs.push(newTab);

        this.renderTab(newTab);
        this.activateTab(newTab.id);
        this.saveTabs();

        const urlInput = document.getElementById("url-input") as HTMLInputElement;
        if (urlInput) {
            urlInput.value = "";
            urlInput.focus();
        }
    }

  private navigateTab(tabId: string, input: string) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    let url = input.trim();
    const isURL = url.includes(".") && !url.includes(" ") && !url.startsWith("about:");
    
    if (url.startsWith("about:")) {
        // Handle about: pages within tabs
        tab.url = url;
        tab.title = url === "about:settings" ? "Settings" : "About Page";
        
        const oldContent = document.getElementById(`content-${tabId}`);
        if (oldContent) oldContent.remove();

        this.renderTabContent(tab);
        
        const newContent = document.getElementById(`content-${tabId}`) as HTMLElement;
        if (newContent) {
            newContent.style.display = 'block';
            newContent.style.zIndex = '10';
        }
        
        this.updateTabDisplay(tabId);
        
        const urlInput = document.getElementById("url-input") as HTMLInputElement;
        if (urlInput) urlInput.value = url;

        this.saveTabs();
        return;
    } else if (!url.startsWith("http://") && !url.startsWith("https://")) {
        if (isURL) {
            url = `https://${url}`;
        } else {
            const searchEngine = this.storage.getVal("searchEngine") || "https://www.google.com/search?q=";
            url = `${searchEngine}${encodeURIComponent(url)}`;
        }
    }

    tab.url = url;
    tab.title = "Loading...";
    
    const oldContent = document.getElementById(`content-${tabId}`);
    if (oldContent) oldContent.remove();

    this.renderTabContent(tab);
    
    const newContent = document.getElementById(`content-${tabId}`) as HTMLElement;
    if (newContent) {
        newContent.style.display = 'block';
        newContent.style.zIndex = '10';
    }
    
    this.updateTabDisplay(tabId);
    
    const urlInput = document.getElementById("url-input") as HTMLInputElement;
    if (urlInput) urlInput.value = url;

    this.saveTabs();
}
    
 private setupEventListeners() {
    document.getElementById("add-tab-btn")?.addEventListener("click", () => this.addTab());

    const urlInput = document.getElementById("url-input") as HTMLInputElement;
    urlInput?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            const activeTab = this.tabs.find(t => t.isActive);
            if (activeTab) {
                this.navigateTab(activeTab.id, urlInput.value);
            }
        }
    });

    document.getElementById("nav-back")?.addEventListener("click", () => this.goBack());
    document.getElementById("nav-forward")?.addEventListener("click", () => this.goForward());
    document.getElementById("nav-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("nav-bookmark")?.addEventListener("click", () => this.addBookmark());
    document.getElementById("nav-fullscreen")?.addEventListener("click", () => this.toggleFullscreen());
    
    // This should be INSIDE the setupEventListeners method
    document.getElementById("nav-settings")?.addEventListener("click", () => {
        // Open settings in current tab
        const activeTab = this.tabs.find(t => t.isActive);
        if (activeTab) {
            this.navigateTab(activeTab.id, "about:settings");
        }
    });
}

    private goBack() {
        const activeTab = this.tabs.find(t => t.isActive);
        if (!activeTab) return;
        
        const iframe = this.iframeRefs.get(activeTab.id);
        iframe?.contentWindow?.history.back();
    }

    private goForward() {
        const activeTab = this.tabs.find(t => t.isActive);
        if (!activeTab) return;
        
        const iframe = this.iframeRefs.get(activeTab.id);
        iframe?.contentWindow?.history.forward();
    }

    private refresh() {
        const activeTab = this.tabs.find(t => t.isActive);
        if (!activeTab) return;
        
        if (activeTab.url) {
            const iframe = this.iframeRefs.get(activeTab.id);
            if (iframe) {
                iframe.contentWindow?.location.reload();
            }
        }
    }

    private addBookmark() {
        const activeTab = this.tabs.find(t => t.isActive);
        if (!activeTab || !activeTab.url || activeTab.url.startsWith("about:")) {
            alert("Cannot bookmark this page");
            return;
        }

        const bookmarks = this.getBookmarks();
        const newBookmark: Bookmark = {
            id: `bookmark-${Date.now()}`,
            title: activeTab.title,
            url: activeTab.url,
            favicon: activeTab.favicon
        };

        bookmarks.push(newBookmark);
        this.saveBookmarks(bookmarks);
        alert("Bookmark added!");
    }

    private toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
            this.isFullscreen = true;
        } else {
            document.exitFullscreen();
            this.isFullscreen = false;
        }
    }

    private handleRedirectParam() {
        const linkElement = document.querySelector("link-element") as any;
        const link = linkElement?.dataset?.link;
        
        if (link) {
            setTimeout(() => {
                try {
                    const decoded = atob(link);
                    const activeTab = this.tabs.find(t => t.isActive);
                    if (activeTab) {
                        this.navigateTab(activeTab.id, decoded);
                    }
                } catch {
                    const activeTab = this.tabs.find(t => t.isActive);
                    if (activeTab) {
                        this.navigateTab(activeTab.id, link);
                    }
                }
                history.pushState({}, "", "/");
            }, 500);
        }
    }

    private setupKeyboardShortcuts() {
        document.addEventListener("keydown", (e) => {
            if (e.ctrlKey && e.key === "t") {
                e.preventDefault();
                this.addTab();
            }
            else if (e.ctrlKey && e.key === "w") {
                e.preventDefault();
                const activeTab = this.tabs.find(t => t.isActive);
                if (activeTab) this.closeTab(activeTab.id);
            }
            else if (e.ctrlKey && e.key === "s") {
                e.preventDefault();
                const urlInput = document.getElementById("url-input") as HTMLInputElement;
                urlInput?.focus();
                urlInput?.select();
            }
            else if (e.ctrlKey && e.key === "Tab" && !e.shiftKey) {
                e.preventDefault();
                const activeIndex = this.tabs.findIndex(t => t.isActive);
                const nextIndex = (activeIndex + 1) % this.tabs.length;
                this.activateTab(this.tabs[nextIndex].id);
            }
            else if (e.ctrlKey && e.shiftKey && e.key === "Tab") {
                e.preventDefault();
                const activeIndex = this.tabs.findIndex(t => t.isActive);
                const prevIndex = activeIndex === 0 ? this.tabs.length - 1 : activeIndex - 1;
                this.activateTab(this.tabs[prevIndex].id);
            }
        });
    }

    private draggedTabId: string | null = null;

    private handleDragStart(e: DragEvent, tabId: string) {
        const settingsStore = new StoreManager<"radius||settings">("radius||settings");
        const allowReordering = settingsStore.getVal("allowTabReordering") === "true";
        
        if (!allowReordering) {
            e.preventDefault();
            return;
        }

        this.draggedTabId = tabId;
        e.dataTransfer!.effectAllowed = "move";
    }

    private handleDragOver(e: DragEvent, targetTabId: string) {
        e.preventDefault();
        
        if (!this.draggedTabId || this.draggedTabId === targetTabId) return;

        const draggedIndex = this.tabs.findIndex(t => t.id === this.draggedTabId);
        const targetIndex = this.tabs.findIndex(t => t.id === targetTabId);

        if (draggedIndex === -1 || targetIndex === -1) return;

        const [draggedTab] = this.tabs.splice(draggedIndex, 1);
        this.tabs.splice(targetIndex, 0, draggedTab);

        const tabsContainer = document.getElementById("tabs-container");
        if (tabsContainer) {
            tabsContainer.innerHTML = "";
            this.tabs.forEach(tab => {
                const existingTab = document.getElementById(`tab-${tab.id}`);
                if (existingTab) existingTab.remove();
                this.renderTab(tab);
            });
        }

        this.saveTabs();
    }

    private handleDragEnd() {
        this.draggedTabId = null;
    }
}

class LinkElement extends HTMLElement {
    connectedCallback() {
        // This element is just for data storage, handled by TabManager
    }
}

customElements.define('link-element', LinkElement);
