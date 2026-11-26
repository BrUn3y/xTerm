set number
set mouse=a

let s:directory = expand('<sfile>:p:h')
let s:buffer = bufnr('%')
let s:file = getbufinfo(s:buffer)[0].name
let s:request = 0
let s:error = ''
let s:published = ''

function! s:publish() abort
  let state = json_encode({'dirty': !!getbufvar(s:buffer, '&modified'),
        \ 'request': s:request, 'error': s:error})
  if state !=# s:published && writefile([state], s:directory . '/state') == 0
    let s:published = state
  endif
endfunction

function! s:poll(timer) abort
  let request = s:directory . '/save'
  if filereadable(request)
    let id = str2nr(get(readfile(request, '', 1), 0, ''))
    if id > s:request
      let s:request = id
      let s:error = ''
      try
        let info = getbufinfo(s:buffer)
        let windows = win_findbuf(s:buffer)
        if empty(info) || info[0].name !=# s:file || empty(windows)
          throw 'Show the original file in vi before saving it from the Explorer.'
        endif
        call win_execute(windows[0], 'silent keepalt write')
        if getbufvar(s:buffer, '&modified')
          throw 'vi did not save the file.'
        endif
      catch
        let s:error = substitute(v:exception, '^Vim\%(([^)]*)\)\=:', '', '')
      endtry
    endif
  endif
  call s:publish()
endfunction

call s:publish()
call timer_start(100, function('s:poll'), {'repeat': -1})
