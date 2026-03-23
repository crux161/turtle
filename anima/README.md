# Anima 

Anima is an port of the MUCH more popular ani-cli (https://github.com/pystardust/ani-cli) 
It is only thru a great deal of love that Anima (the backend for Turtle) was created. 
I would like to take a moment to Thank the ani-cli team for their continued hard work, and
technical excellence -- all for the sake of anime in the terminal. THANK YOU! You guys 
are Awesome! 

That being said, a lot of people don't like the terminal, don't know how to use it -- 
and while I want those people to grow.. This is the bottle these babies have been craving :3

Turtle comes from the idea of: ani-cli -> ani-gui -> GUI -> 龜 gui1 ("trutle") -> Turtle.
"Gui" means turtle in Mandarin Chinese. It's a play on words, and a "deep dive" into a new front-end.

Turtle functions as a standalone Electron app (so it can look FKN GORGEOUS) -- it hosts the backend "Anima" via it's own api server to do the heavy lifting -- the Turtle frontend is simply a consumer.

Realistically, I'd like to re-write this project in Go so I could utilize the Charm.land ecosystem to make a really sexy TUI for ani-cli... but Turtle was originally (and still is!) a "Gamelette" (MY TERM for a flippin' mini-game, alt.spelling 'gamelet') which is a fancy way of saying it's a fairly quarantined iframe functioning inside a greater electron app (evil on top of evil I know 🙃 ) to let users watch shows together, or play games.  This is basically my version of "discord activities" but could be used privately by other institutions for other purposes. It's a great space to put WASM modules for anything the requires heavy-lifting (computationally expensive?) or cross-platform excellence (N64 emulator in wasm? yes :3 or statically recompiled to wasm, works beautifully -- save-files, controller support). 

This is all still a bit of a mixed bag. but I think my heart is in the right place.
Thanks for taking the time to read this. Leave a star if you made it this far! :3
