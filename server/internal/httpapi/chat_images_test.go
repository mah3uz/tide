package httpapi

import (
	"net/http"
	"strings"
	"testing"

	"tide/internal/api"
	"tide/internal/auth"
	"tide/internal/config"
)

// TIDE_CHAT_IMAGES reaches every participant through the room's public
// info, which a guest without a session reads too: on a signed-in
// deployment /api/me answers a guest 401, so a switch there would leave
// guests unable to see images the host sends.
func TestChatImagesSwitchReachesHostsAndGuests(t *testing.T) {
	for _, on := range []bool{false, true} {
		t.Run(map[bool]string{false: "off", true: "on"}[on], func(t *testing.T) {
			k := startTide(t, func(cfg *config.Config, _ *http.Server) { cfg.ChatImages = on })
			alice := k.signIn(auth.Session{Sub: "alice", Name: "Alice"})
			room := alice.createRoom("Standup")

			var hosts api.PublicRoomInfo
			alice.send(http.MethodGet, fill(api.RoomPath, room.Slug), http.StatusOK, &hosts)
			guest := k.browser("192.0.2.30")
			guest.want(http.MethodGet, api.MePath, "", http.StatusUnauthorized, nil)
			var guests api.PublicRoomInfo
			guest.want(http.MethodGet, fill(api.RoomPath, room.Slug), "", http.StatusOK, &guests)
			if !hosts.CanManage || guests.CanManage {
				t.Fatalf("can_manage: host %v, guest %v", hosts.CanManage, guests.CanManage)
			}
			if hosts.ChatImages != on || guests.ChatImages != on {
				t.Fatalf("chat_images: host %v, guest %v, want %v", hosts.ChatImages, guests.ChatImages, on)
			}
		})
	}
}

// Received images are shown from object URLs, so img-src allows blob:, and
// nothing else gains it: a blob: script source would let a page run code it
// made itself.
func TestContentSecurityPolicyAllowsBlobImagesOnly(t *testing.T) {
	directives := map[string]string{}
	for _, directive := range strings.Split(contentSecurityPolicy, ";") {
		name, sources, _ := strings.Cut(strings.TrimSpace(directive), " ")
		directives[name] = sources
	}
	if got, want := directives["img-src"], "'self' data: blob:"; got != want {
		t.Fatalf("img-src = %q, want %q", got, want)
	}
	for name, sources := range directives {
		if name != "img-src" && name != "media-src" && strings.Contains(sources, "blob:") {
			t.Errorf("%s = %q allows blob:", name, sources)
		}
	}
}
