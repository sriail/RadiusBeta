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
    // Properly formatted Material Symbols settings icon
    private settingsIconUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath fill='%23888888' d='M13.875 22h-3.75q-.375 0-.65-.25t-.325-.625l-.3-2.325q-.325-.125-.612-.3t-.563-.375l-2.175.9q-.35.125-.7.025t-.55-.425L2.4 15.4q-.2-.325-.125-.7t.375-.6l1.875-1.425Q4.5 12.5 4.5 12.337v-.674q0-.163.025-.338L2.65 9.9q-.3-.225-.375-.6t.125-.7l1.85-3.225q.175-.35.537-.438t.713.038l2.175.9q.275-.2.575-.375t.6-.3l.3-2.325q.05-.375.325-.625t.65-.25h3.75q.375 0 .65.25t.325.625l.3 2.325q.325.125.613.3t.562.375l2.175-.9q.35-.125.7-.025t.55.425L21.6 8.6q.2.325.125.7t-.375.6l-1.875 1.425q.025.175.025.338v.674q0 .163-.05.338l1.875 1.425q.3.225.375.6t-.125.7l-1.85 3.2q-.2.325-.562.438t-.713-.013l-2.125-.9q-.275.2-.575.375t-.6.3l-.3 2.325q-.05.375-.325.625t-.65.25M12 15.5q1.45 0 2.475-1.025T15.5 12t-1.025-2.475T12 8.5T9.525 9.525T8.5 12t1.025 2.475T12 15.5'/%3E%3C/svg%3E";

    constructor() {
        this.storage = new StoreManager<"radius||tabs">("radius||tabs");
        this.bookmarkStorage = new StoreManager<"radius||bookmarks">("radius||bookmarks");
        this.bareClient = new BareClient();
        this.preloadSettingsIcon();
    }

    private preloadSettingsIcon() {
        const img = new Image();
        img.src = this.settingsIconUrl;
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
        <div class="h-full w-full flex font-inter">
            <div class="w-1/4 bg-(--background) flex mt-14 overflow-hidden">
                <div class="h-full w-full flex flex-col font-inter p-4 pl-8 pt-8 gap-2 overflow-y-auto">
                    <a href="#" data-settings-page="proxy" class="settings-nav-link gap-2 px-4 py-2 rounded-lg h-10 w-full text-sm font-medium transition-colors items-center justify-start inline-flex bg-(--secondary) hover:bg-(--secondary)/[0.8]">
                        <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2M9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9zm9 14H6V10h12zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2s-2 .9-2 2s.9 2 2 2"/></svg>
                        Proxy
                    </a>
                    <a href="#" data-settings-page="appearance" class="settings-nav-link gap-2 px-4 py-2 rounded-lg h-10 w-full text-sm font-medium transition-colors items-center justify-start inline-flex bg-(--background) hover:bg-(--accent)">
                        <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 22q-2.05 0-3.875-.788t-3.187-2.15t-2.15-3.187T2 12q0-2.075.788-3.887t2.15-3.175T8.124 2.788T12 2q.425 0 .713.288T13 3v2q0 .825.588 1.413T15 7h2q.425 0 .713.288T18 8v1.5q0 .425.288.713T19 10.5q.425 0 .713-.288T20 9.5V8q0-1.25-.875-2.125T17 5h-2q0-1.25-.875-2.125T12 2Q9.075 2 6.537 4.15T4 9.25q0 1.725.55 3.238t1.55 2.762t2.4 2.013T12 18q.425 0 .713.288T13 19q0 .425-.288.713T12 20m0 2q-.425 0-.712-.288T11 21q0-.425.288-.712T12 20q3.35 0 5.675-2.325T20 12q0-.425.288-.712T21 11q.425 0 .713.288T22 12q0 2.075-.788 3.888t-2.15 3.174t-3.187 2.15T12 22m-3-7.75q-.525 0-.887-.363T7.75 13q0-.525.363-.887T9 11.75q.525 0 .888.363T10.25 13q0 .525-.363.888T9 14.25m6 0q-.525 0-.887-.363T13.75 13q0-.525.363-.887T15 11.75q.525 0 .888.363T16.25 13q0 .525-.363.888T15 14.25"/></svg>
                        Appearance
                    </a>
                    <a href="#" data-settings-page="credits" class="settings-nav-link gap-2 px-4 py-2 rounded-lg h-10 w-full text-sm font-medium transition-colors items-center justify-start inline-flex bg-(--background) hover:bg-(--accent)">
                        <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3s1.34 3 3 3m-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5S5 6.34 5 8s1.34 3 3 3m0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5m8 0c-.29 0-.62.02-.97.05c1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5"/></svg>
                        Credits
                    </a>
                    <a href="#" data-settings-page="cloaking" class="settings-nav-link gap-2 px-4 py-2 rounded-lg h-10 w-full text-sm font-medium transition-colors items-center justify-start inline-flex bg-(--background) hover:bg-(--accent)">
                        <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 6.5a9.77 9.77 0 0 1 8.82 5.5c-1.65 3.37-5.02 5.5-8.82 5.5S4.83 15.37 3.18 12A9.77 9.77 0 0 1 12 6.5m0-2C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5m0 5a2.5 2.5 0 0 1 0 5a2.5 2.5 0 0 1 0-5m0-2c-2.48 0-4.5 2.02-4.5 4.5s2.02 4.5 4.5 4.5s4.5-2.02 4.5-4.5s-2.02-4.5-4.5-4.5"/></svg>
                        Cloaking
                    </a>
                </div>
            </div>
            <div class="h-full mt-14 flex-grow px-12 py-8 flex flex-col overflow-hidden">
                <div id="settings-content-area" class="h-full overflow-y-auto">
                    ${this.getProxySettingsHTML()}
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

         const handleNavClick = (e: Event) => {
            e.preventDefault();
            const target = e.currentTarget as HTMLElement;
            const page = target.dataset.settingsPage;
            
            if (!page) return;
            
            // Update active state for all nav links
            const allNavLinks = document.querySelectorAll(".settings-nav-link");
            allNavLinks.forEach(link => {
                link.className = "settings-nav-link gap-2 px-4 py-2 rounded-lg h-10 w-full text-sm font-medium transition-colors items-center justify-start inline-flex bg-(--background) hover:bg-(--accent)";
            });
            target.className = "settings-nav-link gap-2 px-4 py-2 rounded-lg h-10 w-full text-sm font-medium transition-colors items-center justify-start inline-flex bg-(--secondary) hover:bg-(--secondary)/[0.8]";
            
            // Update content based on selected page
            const contentArea = document.getElementById("settings-content-area");
            if (!contentArea) return;

            if (page === "proxy") {
                contentArea.innerHTML = this.getProxySettingsHTML();
                setTimeout(() => this.setupProxyPageListeners(), 50);
            } else if (page === "appearance") {
                contentArea.innerHTML = this.getAppearanceSettingsHTML();
                setTimeout(() => this.setupAppearancePageListeners(), 50);
            } else if (page === "credits") {
                contentArea.innerHTML = this.getCreditsHTML();
            } else if (page === "cloaking") {
                contentArea.innerHTML = this.getCloakingHTML();
                setTimeout(() => this.setupCloakingPageListeners(), 50);
            }
        };

        // Add click listeners to navigation links
        const navLinks = document.querySelectorAll(".settings-nav-link");
        navLinks.forEach(link => {
            link.addEventListener("click", handleNavClick);
        });

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
                                </select>
                            </div>
                        </div>
                    `;
                    
                    const themeDropdown = document.getElementById("dropdownBox-themeSwitcher") as HTMLSelectElement;
                    if (themeDropdown && this.settings) {
                        themeDropdown.value = this.storage.getVal('theme');
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
    
    private setupCloakingPageListeners() {
    const aboutBlankInput = document.getElementById("aboutBlankCloaker") as HTMLInputElement;
    const aboutBlankButton = document.getElementById("aboutBlankLaunch") as HTMLButtonElement;
    const blobInput = document.getElementById("blobCloaker") as HTMLInputElement;
    const blobButton = document.getElementById("blobLaunch") as HTMLButtonElement;

    if (aboutBlankButton && aboutBlankInput && this.sw && this.settings) {
        aboutBlankButton.addEventListener("click", () => {
            const url = aboutBlankInput.value || "https://google.com";
            const searchUrl = this.sw!.search(url, this.storage.getVal('searchEngine') || 'https://www.google.com/search?q=');
            if (this.settings) {
                this.settings.cloak(searchUrl).aboutBlank();
            }
        });
    }

    if (blobButton && blobInput && this.sw && this.settings) {
        blobButton.addEventListener("click", () => {
            const url = blobInput.value || "https://google.com";
            const searchUrl = this.sw!.search(url, this.storage.getVal('searchEngine') || 'https://www.google.com/search?q=');
            if (this.settings) {
                this.settings.cloak(searchUrl).blob();
            }
        });
    }
}

    private getAppearanceSettingsHTML(): string {
    // Available themes based on your theme files
    const themes = [
        { name: 'Default', value: 'default' },
        { name: 'Bluelight', value: 'bluelight' },
        { name: 'Catpuccin', value: 'catpuccin' },
        { name: 'Cyberpunk', value: 'cyberpunk' },
        { name: 'Midnight', value: 'midnight' }
    ];
    
    return `
        <h1 class="text-4xl font-semibold">Appearance</h1>
        <div class="border-b border-(--border) w-full mb-4"></div>
        <div class="w-full flex-grow">
            <div>
                <p>Themes</p>
                <select id="dropdownBox-themeSwitcher" class="cursor-pointer flex h-10 w-[180px] items-center justify-between text-(--foreground) background-(--background) rounded-lg border border-(--border) px-3 py-2 text-sm appearance-auto">
                    ${themes.map(theme => `<option class="w-full bg-(--accent) rounded-sm p-1" value="${theme.value}">${theme.name}</option>`).join('')}
                </select>
            </div>
        </div>
    `;
}

    private getCloakingHTML(): string {
    return `
        <h1 class="text-4xl font-semibold">Cloaking</h1>
        <div class="border-b border-(--border) w-full mb-4"></div>
        <div class="w-full flex-grow">
            <div class="w-full flex flex-row gap-4">
                <div class="w-1/2">
                    <div>
                        <p>About Blank</p>
                        <input class="h-10 w-full rounded-md border border-(--border) px-3 py-2 text-sm mt-2" placeholder="Redirect url (EX: https://google.com)" id="aboutBlankCloaker" />
                    </div>
                    <div class="mt-2">
                        <button id="aboutBlankLaunch" class="bg-(--primary) hover:bg-(--primary)/90 cursor-pointer text-(--primary-foreground) inline-flex items-center jusitfy-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors h-10 px-4 py-2">
                            <svg class="text-(--primary-foreground) h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                <polyline points="15 3 21 3 21 9"></polyline>
                                <line x1="10" y1="14" x2="21" y2="3"></line>
                            </svg>
                            Cloak!
                        </button>
                    </div>
                </div>
                <div class="w-1/2">
                    <div>
                        <p>Blob</p>
                        <input class="h-10 w-full rounded-md border border-(--border) px-3 py-2 text-sm mt-2" placeholder="Redirect url (EX: https://google.com)" id="blobCloaker" />
                    </div>
                    <div class="mt-2">
                        <button id="blobLaunch" class="bg-(--primary) hover:bg-(--primary)/90 cursor-pointer text-(--primary-foreground) inline-flex items-center jusitfy-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors h-10 px-4 py-2">
                            <svg class="text-(--primary-foreground) h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                <polyline points="15 3 21 3 21 9"></polyline>
                                <line x1="10" y1="14" x2="21" y2="3"></line>
                            </svg>
                            Cloak!
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
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
